import 'dotenv/config'
import fs from 'fs/promises'
import { fileURLToPath } from 'url'
import { isMock, isSaveFixture } from '../utils/flags.js'

const MAX_PAGES_PER_QUERY = 2
const PAGE_SIZE = 50
const EXCERPT_MAX_CHARS = 200
const COMMENT_MAX_CHARS = 300

/**
 * Loads and validates the Confluence config file.
 * @returns {Promise<{ ok: boolean, config?: object, error?: string }>}
 */
async function loadConfig() {
  const configPath = process.env.CONFLUENCE_CONFIG_PATH ?? './config/confluence.json'
  let raw
  try {
    raw = await fs.readFile(configPath, 'utf-8')
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { ok: false, error: `Confluence config missing — create ${configPath} from config/confluence.example.json` }
    }
    return { ok: false, error: `Failed to read Confluence config: ${err.message}` }
  }

  let config
  try {
    config = JSON.parse(raw)
  } catch {
    return { ok: false, error: 'Confluence config is not valid JSON' }
  }

  if (!Array.isArray(config.spaces) || config.spaces.length === 0) {
    return { ok: false, error: 'Confluence config missing or no spaces configured — create config/confluence.json' }
  }

  return {
    ok: true,
    config: {
      spaces: config.spaces,
      lookback_hours_override: config.lookback_hours_override ?? null,
    },
  }
}

/**
 * Makes an authenticated GET request to the Confluence REST API.
 * @param {string} path - API path relative to CONFLUENCE_BASE_URL
 * @param {object} [params] - Query parameters
 * @returns {Promise<object>}
 */
async function confluenceFetch(path, params = {}) {
  const baseUrl = process.env.CONFLUENCE_BASE_URL
  if (!baseUrl) throw new Error('[confluence] CONFLUENCE_BASE_URL is not set')

  const user = process.env.CONFLUENCE_USER
  const token = process.env.CONFLUENCE_API_TOKEN
  if (!user || !token) throw new Error('[confluence] CONFLUENCE_USER or CONFLUENCE_API_TOKEN is not set')

  const auth = Buffer.from(`${user}:${token}`).toString('base64')
  const url = new URL(`${baseUrl}${path}`)

  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) url.searchParams.set(k, String(v))
  }

  const response = await fetch(url.toString(), {
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/json',
    },
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    const err = new Error(`Confluence API ${response.status}: ${text.slice(0, 200)}`)
    err.status = response.status
    throw err
  }

  return response.json()
}

/**
 * Strips HTML tags from a Confluence storage-format string.
 * @param {string} html
 * @returns {string}
 */
function stripHtml(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * Builds a breadcrumb string from the last 2 ancestors.
 * @param {Array} ancestors
 * @returns {string}
 */
function buildBreadcrumb(ancestors) {
  if (!ancestors?.length) return ''
  return ancestors.slice(-2).map(a => a.title).join(' > ')
}

/**
 * Maps a raw Confluence page to the canonical data shape.
 * @param {object} page - Raw Confluence page from API
 * @param {'modified'|'mentioned'} reason
 * @param {string} baseUrl
 * @returns {object}
 */
function mapPage(page, reason, baseUrl) {
  const rawExcerpt = page.body?.excerpt?.value ?? ''
  const excerpt = rawExcerpt.slice(0, EXCERPT_MAX_CHARS)
  const breadcrumb = buildBreadcrumb(page.ancestors)

  // Prefer _links for canonical URL; fall back to constructed URL
  const url = (page._links?.base && page._links?.webui)
    ? `${page._links.base}${page._links.webui}`
    : `${baseUrl}/pages/viewpage.action?pageId=${page.id}`

  return {
    id: page.id,
    title: page.title,
    space: page.space?.name ?? page.space?.key ?? '',
    spaceKey: page.space?.key ?? '',
    reason,
    lastModifiedBy: page.version?.by?.displayName ?? page.version?.by?.username ?? 'Unknown',
    lastModifiedAt: page.version?.when ?? null,
    excerpt,
    breadcrumb,
    url,
    version: page.version?.number ?? null,
  }
}

/**
 * Runs a CQL search query with pagination, up to MAX_PAGES_PER_QUERY pages.
 * @param {string} cql
 * @param {string} [expand]
 * @returns {Promise<{ results: object[], truncated: boolean }>}
 */
async function runCqlQuery(cql, expand = 'version,space,body.excerpt,ancestors') {
  const allResults = []
  let start = 0
  let truncated = false

  for (let page = 0; page < MAX_PAGES_PER_QUERY; page++) {
    const response = await confluenceFetch('/rest/api/content/search', {
      cql,
      start,
      limit: PAGE_SIZE,
      expand,
    })

    const results = response.results ?? []
    allResults.push(...results)

    if (results.length < PAGE_SIZE) break

    if (page === MAX_PAGES_PER_QUERY - 1) {
      truncated = true
    }

    start += PAGE_SIZE
  }

  return { results: allResults, truncated }
}

/**
 * Fallback: runs the page query per space individually when the combined CQL fails.
 * Used when Confluence CQL rejects a space key in the combined `in (...)` clause.
 * @param {string[]} spaces
 * @param {number} hours
 * @returns {Promise<{ results: object[], truncated: boolean }>}
 */
async function runSpacesIndividually(spaces, hours) {
  const allResults = []
  let truncated = false

  for (const space of spaces) {
    const cql = `space = "${space}" AND lastModified >= now("-${hours}h") AND type = page ORDER BY lastModified DESC`
    try {
      const { results, truncated: t } = await runCqlQuery(cql)
      allResults.push(...results)
      if (t) truncated = true
    } catch (err) {
      console.warn(`[confluence] Skipping space "${space}": ${err.message}`)
    }
  }

  return { results: allResults, truncated }
}

/**
 * Fetches recently modified Confluence pages from watched spaces.
 * Runs two CQL queries in parallel: recent page changes, and pages where user was mentioned.
 * @param {Date} since - Lookback start time (hours derived from config/env)
 * @returns {Promise<{ ok: boolean, data?: { pages: object[], truncated: boolean }, error?: string }>}
 */
export async function fetchConfluence(since) {
  if (isMock) {
    try {
      const fixture = JSON.parse(await fs.readFile('tests/fixtures/confluence.json', 'utf-8'))
      return fixture
    } catch {
      return { ok: false, error: 'Mock fixture not found: tests/fixtures/confluence.json' }
    }
  }

  const configResult = await loadConfig()
  if (!configResult.ok) return { ok: false, error: configResult.error }

  const { config } = configResult
  const baseUrl = process.env.CONFLUENCE_BASE_URL
  const hours = config.lookback_hours_override ?? parseInt(process.env.LOOKBACK_HOURS ?? '24')
  const spaceClause = `space in (${config.spaces.map(s => `"${s}"`).join(', ')})`

  try {
    // Fetch current user's username for mention search
    let username = null
    try {
      const me = await confluenceFetch('/rest/api/user/current')
      username = me.username ?? me.accountId ?? null
    } catch (err) {
      console.warn('[confluence] Could not fetch current user — mention search will be skipped:', err.message)
    }

    // Query 1: recently modified pages
    const q1 = `${spaceClause} AND lastModified >= now("-${hours}h") AND type = page ORDER BY lastModified DESC`

    // Query 2: pages where user was mentioned in comments (skip if no username)
    const q2 = username
      ? `${spaceClause} AND type = comment AND text ~ "[~${username}]" AND created >= now("-${hours}h")`
      : null

    const [q1Result, q2Result] = await Promise.allSettled([
      runCqlQuery(q1).catch(err => {
        // Combined CQL may fail if a space key is invalid — fall back to per-space queries
        console.warn('[confluence] Combined CQL failed, trying per-space fallback:', err.message)
        return runSpacesIndividually(config.spaces, hours)
      }),
      q2
        ? runCqlQuery(q2, 'version,space,ancestors,container').catch(err => {
            console.warn('[confluence] Mention search unavailable, skipping:', err.message)
            return { results: [], truncated: false }
          })
        : Promise.resolve({ results: [], truncated: false }),
    ])

    const pageMap = new Map()
    let truncated = false

    // Add Query 1 results (reason: 'modified')
    if (q1Result.status === 'fulfilled') {
      if (q1Result.value.truncated) truncated = true
      for (const page of q1Result.value.results) {
        pageMap.set(page.id, mapPage(page, 'modified', baseUrl))
      }
    } else {
      console.error('[confluence] Page query failed:', q1Result.reason?.message)
    }

    // Add Query 2 results (reason: 'mentioned') — overwrite if page already in map
    if (q2Result.status === 'fulfilled') {
      if (q2Result.value.truncated) truncated = true
      for (const comment of q2Result.value.results) {
        // Comment container points to the parent page
        const pageId = comment.container?.id
        if (!pageId) continue

        if (pageMap.has(pageId)) {
          pageMap.set(pageId, { ...pageMap.get(pageId), reason: 'mentioned' })
        } else {
          // Fetch the parent page if we don't already have it
          try {
            const page = await confluenceFetch(`/rest/api/content/${pageId}`, {
              expand: 'version,space,body.excerpt,ancestors',
            })
            pageMap.set(pageId, mapPage(page, 'mentioned', baseUrl))
          } catch (err) {
            console.warn(`[confluence] Could not fetch parent page ${pageId}:`, err.message)
          }
        }
      }
    }

    return { ok: true, data: { pages: Array.from(pageMap.values()), truncated } }
  } catch (err) {
    if (err.status === 401) {
      return { ok: false, error: 'Confluence auth failed — check CONFLUENCE_USER and CONFLUENCE_API_TOKEN' }
    }
    if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
      return { ok: false, error: 'Confluence unreachable — check CONFLUENCE_BASE_URL and VPN' }
    }
    return { ok: false, error: `Confluence fetch failed: ${err.message}` }
  }
}

// Standalone runner
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const result = await fetchConfluence(since)
  console.log(JSON.stringify(result, null, 2))

  if (isSaveFixture) {
    await fs.writeFile('tests/fixtures/confluence.json', JSON.stringify(result, null, 2))
    console.log('[confluence] Fixture saved to tests/fixtures/confluence.json')
  }
}
