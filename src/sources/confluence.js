import 'dotenv/config'
import fs from 'fs/promises'
import { fileURLToPath } from 'url'
import { isMock, isSaveFixture, debug, lookbackHours } from '../utils/flags.js'

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
      ancestor_page_ids: Array.isArray(config.ancestor_page_ids) ? config.ancestor_page_ids : [],
      lookback_hours_override: config.lookback_hours_override ?? null,
      exclude_title_patterns: Array.isArray(config.exclude_title_patterns) ? config.exclude_title_patterns : [],
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

  const token = process.env.CONFLUENCE_API_TOKEN
  if (!token) throw new Error('[confluence] CONFLUENCE_API_TOKEN is not set')

  const url = new URL(`${baseUrl}${path}`)

  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) url.searchParams.set(k, String(v))
  }

  // Confluence DC PATs are Bearer tokens (not Basic Auth credentials).
  // See: https://confluence.atlassian.com/enterprise/using-personal-access-tokens-1026032365.html
  const response = await fetch(url.toString(), {
    headers: {
      'Authorization': `Bearer ${token}`,
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
    debug('[confluence]', `CQL page ${page + 1}/${MAX_PAGES_PER_QUERY} (start=${start})...`)
    const response = await confluenceFetch('/rest/api/content/search', {
      cql,
      start,
      limit: PAGE_SIZE,
      expand,
    })

    const results = response.results ?? []
    allResults.push(...results)
    debug('[confluence]', `page ${page + 1}: ${results.length} results (${allResults.length} total)`)

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
 * @param {string} ancestorClause - Additional CQL clause for ancestor scoping (may be empty)
 * @returns {Promise<{ results: object[], truncated: boolean }>}
 */
async function runSpacesIndividually(spaces, hours, ancestorClause = '') {
  const allResults = []
  let truncated = false

  for (const space of spaces) {
    debug('[confluence]', `Querying space "${space}" individually...`)
    const cql = `space = "${space}"${ancestorClause} AND lastModified >= now("-${hours}h") AND type = page ORDER BY lastModified DESC`
    try {
      const { results, truncated: t } = await runCqlQuery(cql)
      debug('[confluence]', `space "${space}": ${results.length} pages`)
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
 * @param {Date} since - Lookback start time (honours --days flag)
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
  const derivedHours = Math.round((Date.now() - since.getTime()) / (60 * 60 * 1000))
  const hours = config.lookback_hours_override ?? derivedHours
  const spaceClause = `space in (${config.spaces.map(s => `"${s}"`).join(', ')})`
  const ancestorClause = config.ancestor_page_ids.length > 0
    ? ` AND ancestor in (${config.ancestor_page_ids.join(', ')})`
    : ''
  if (config.ancestor_page_ids.length > 0) {
    debug('[confluence]', `Fetching from ${config.spaces.length} spaces, ${config.ancestor_page_ids.length} ancestor(s), lookback ${hours}h`)
  } else {
    debug('[confluence]', `Fetching from ${config.spaces.length} spaces, lookback ${hours}h`)
  }

  try {
    let username = null
    try {
      debug('[confluence]', 'Fetching current user info...')
      const me = await confluenceFetch('/rest/api/user/current')
      username = me.username ?? me.accountId ?? null
      debug('[confluence]', `User: ${me.displayName ?? username ?? 'unknown'}`)
    } catch (err) {
      if (!err.status) throw err  // network error (no HTTP status) — server unreachable, likely VPN
      if (err.status === 401) throw err
      console.warn('[confluence] Could not fetch current user — mention search will be skipped:', err.message)
    }

    // Query 1: recently modified pages (scoped to ancestor subtrees if configured)
    const q1 = `${spaceClause}${ancestorClause} AND lastModified >= now("-${hours}h") AND type = page ORDER BY lastModified DESC`

    // Query 2: pages where user was mentioned in comments (skip if no username)
    const q2 = username
      ? `${spaceClause}${ancestorClause} AND type = comment AND text ~ "[~${username}]" AND created >= now("-${hours}h")`
      : null

    debug('[confluence]', `Running ${q2 ? 2 : 1} CQL queries (pages${q2 ? ' + mentions' : ''})...`)
    const t0 = Date.now()

    const [q1Result, q2Result] = await Promise.allSettled([
      runCqlQuery(q1).catch(err => {
        console.warn('[confluence] Combined CQL failed, trying per-space fallback:', err.message)
        return runSpacesIndividually(config.spaces, hours, ancestorClause)
      }),
      q2
        ? runCqlQuery(q2, 'version,space,ancestors,container').catch(err => {
            console.warn('[confluence] Mention search unavailable, skipping:', err.message)
            return { results: [], truncated: false }
          })
        : Promise.resolve({ results: [], truncated: false }),
    ])
    debug('[confluence]', `CQL queries completed in ${Date.now() - t0}ms`)

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

    let pages = Array.from(pageMap.values())

    // Hard filter: exclude pages whose titles match any configured pattern (case-insensitive substring)
    if (config.exclude_title_patterns.length > 0) {
      const before = pages.length
      pages = pages.filter(p => !config.exclude_title_patterns.some(pat =>
        p.title.toLowerCase().includes(pat.toLowerCase())
      ))
      if (pages.length < before) {
        debug('[confluence]', `Excluded ${before - pages.length} pages by title pattern filter`)
      }
    }

    const mentioned = pages.filter(p => p.reason === 'mentioned').length
    debug('[confluence]', `${pages.length} pages (${mentioned} with mentions)${truncated ? ' [truncated]' : ''}`)

    return { ok: true, data: { pages, truncated } }
  } catch (err) {
    if (err.status === 401) {
      return { ok: false, error: 'Confluence auth failed — check CONFLUENCE_API_TOKEN in .env' }
    }
    const networkCode = err.cause?.code
    const SSL_CODES = ['UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'SELF_SIGNED_CERT_IN_CHAIN',
      'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'ERR_TLS_CERT_ALTNAME_INVALID', 'CERT_HAS_EXPIRED']
    if (SSL_CODES.includes(networkCode) || err.message?.includes('certificate')) {
      return { ok: false, error: 'Confluence SSL error — certificate could not be verified. Are you on VPN?' }
    }
    if (!err.status) {
      // No HTTP status → network/connectivity failure (ECONNREFUSED, ENOTFOUND, ETIMEDOUT, etc.)
      return { ok: false, error: 'Confluence unreachable — are you on VPN?' }
    }
    return { ok: false, error: `Confluence fetch failed: ${err.message}` }
  }
}

// Standalone runner
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const since = new Date(Date.now() - lookbackHours * 60 * 60 * 1000)
  const result = await fetchConfluence(since)
  console.log(JSON.stringify(result, null, 2))

  if (isSaveFixture) {
    await fs.writeFile('tests/fixtures/confluence.json', JSON.stringify(result, null, 2))
    console.log('[confluence] Fixture saved to tests/fixtures/confluence.json')
  }
}
