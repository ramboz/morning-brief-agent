#!/usr/bin/env node

/**
 * fetch-confluence.js — Confluence DC REST API → JSON
 *
 * Modes:
 *   --brief              Lookback scan: recently updated pages in watched spaces
 *   --search "query"     Deep Dive: CQL search by keyword
 *
 * Standalone: node scripts/fetch-confluence.js --brief
 * Reference:  specs/07-confluence.md
 */

import dotenv from 'dotenv'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs, loadConfig, envelope } from './lib/config.js'
import { atlassianFetch } from './lib/atlassianFetch.js'

dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), '.env') })

const TOOL = 'confluence'
const MAX_PAGES_PER_QUERY = 2
const PAGE_SIZE = 50
const EXPAND = 'version,space,body.excerpt,ancestors'

/**
 * Make a GET request to the Confluence REST API with Bearer auth.
 * @param {string} baseUrl - Confluence base URL
 * @param {string} token - PAT token
 * @param {string} path - API path
 * @param {object} [params] - Query string parameters
 * @returns {Promise<object>} Parsed JSON response
 */
async function confluenceGet(baseUrl, token, path, params = {}) {
  const qs = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null)
  ).toString()
  const fullPath = qs ? `${path}?${qs}` : path
  return atlassianFetch(baseUrl, fullPath, token)
}

/**
 * Strip HTML tags from a string (for comment bodies in Confluence storage format).
 * @param {string} html - Raw HTML/XML string
 * @returns {string} Plain text
 */
function stripHtml(html) {
  if (!html) return ''
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * Build a breadcrumb string from an ancestors array.
 * @param {Array<{title: string}>} ancestors - Ancestor page objects
 * @returns {string} e.g. "Engineering > Backend"
 */
function buildBreadcrumb(ancestors) {
  if (!ancestors || ancestors.length === 0) return ''
  return ancestors.slice(-2).map(a => a.title).join(' > ')
}

/**
 * Paginate a CQL search query, up to MAX_PAGES_PER_QUERY pages.
 * @param {string} baseUrl
 * @param {string} token
 * @param {string} cql
 * @param {string} [expand]
 * @returns {Promise<{results: object[], truncated: boolean}>}
 */
async function paginateCql(baseUrl, token, cql, expand = EXPAND) {
  const results = []
  let start = 0
  let truncated = false

  for (let page = 0; page < MAX_PAGES_PER_QUERY; page++) {
    const data = await confluenceGet(baseUrl, token, '/rest/api/content/search', {
      cql,
      start,
      limit: PAGE_SIZE,
      expand
    })

    results.push(...(data.results ?? []))

    const size = data.results?.length ?? 0
    if (size < PAGE_SIZE) break

    start += PAGE_SIZE

    if (page === MAX_PAGES_PER_QUERY - 1 && results.length < (data.totalSize ?? data.size ?? 0)) {
      truncated = true
    }
  }

  return { results, truncated }
}

/**
 * Map a raw Confluence page result to the output shape.
 * @param {object} page - Raw Confluence result object
 * @param {string} reason - 'modified' | 'mentioned'
 * @param {string} baseUrl - Confluence base URL
 * @returns {object} Formatted page
 */
function formatPage(page, reason, baseUrl) {
  const ancestors = page.ancestors ?? []
  const excerpt = (page.body?.excerpt?.value ?? '').slice(0, 200)
  const version = page.version?.number ?? null
  const lastModifiedBy = page.version?.by?.displayName ?? page.version?.by?.username ?? 'unknown'
  const lastModifiedAt = page.version?.when
  const spaceKey = page.space?.key ?? ''

  // Build the page URL
  const titleSlug = encodeURIComponent((page.title ?? '').replace(/ /g, '+'))
  const url = page._links?.webui
    ? `${baseUrl}${page._links.webui}`
    : `${baseUrl}/display/${spaceKey}/${titleSlug}`

  return {
    id: page.id,
    title: page.title ?? '',
    space: page.space?.name ?? spaceKey,
    spaceKey,
    reason,
    lastModifiedBy,
    lastModifiedAt,
    excerpt,
    breadcrumb: buildBreadcrumb(ancestors),
    url,
    version
  }
}

/**
 * Fetch recently modified pages in watched spaces (Q1).
 * Falls back to per-space queries if combined CQL fails.
 * @param {string} baseUrl
 * @param {string} token
 * @param {string[]} spaces
 * @param {number} hours
 * @returns {Promise<{pages: object[], truncated: boolean}>}
 */
async function fetchModifiedPages(baseUrl, token, spaces, hours) {
  const spaceClause = `space in (${spaces.map(s => `"${s}"`).join(', ')})`
  const cql = `${spaceClause} AND lastModified >= now("-${hours}h") AND type = page ORDER BY lastModified DESC`

  try {
    const { results, truncated } = await paginateCql(baseUrl, token, cql)
    return { pages: results, truncated }
  } catch (err) {
    // CQL error (e.g. invalid space key) — fall back to per-space queries
    if (err.status === 400 || err.status === 404) {
      console.error(`[${TOOL}] Combined CQL failed, falling back to per-space queries`)
      const allPages = []
      let truncated = false
      for (const space of spaces) {
        const perCql = `space = "${space}" AND lastModified >= now("-${hours}h") AND type = page ORDER BY lastModified DESC`
        try {
          const { results, truncated: t } = await paginateCql(baseUrl, token, perCql)
          allPages.push(...results)
          if (t) truncated = true
        } catch (spaceErr) {
          if (spaceErr.status === 404 || spaceErr.status === 400) {
            console.error(`[${TOOL}] Skipping space ${space}: ${spaceErr.message}`)
          } else {
            throw spaceErr
          }
        }
      }
      return { pages: allPages, truncated }
    }
    throw err
  }
}

/**
 * Fetch pages where the user was mentioned in comments (Q2).
 * Returns empty array on failure — Q2 is best-effort only.
 * @param {string} baseUrl
 * @param {string} token
 * @param {string[]} spaces
 * @param {string} username
 * @param {number} hours
 * @returns {Promise<object[]>} Array of raw page objects
 */
async function fetchMentionedPages(baseUrl, token, spaces, username, hours) {
  const spaceClause = `space in (${spaces.map(s => `"${s}"`).join(', ')})`
  const cql = `${spaceClause} AND type = comment AND text ~ "[~${username}]" AND created >= now("-${hours}h")`

  try {
    const { results } = await paginateCql(baseUrl, token, cql, 'ancestors,container,body.storage')
    const mentionedPageIds = new Set()
    const mentionedPages = []

    for (const comment of results) {
      const container = comment.container
      if (!container || mentionedPageIds.has(container.id)) continue
      mentionedPageIds.add(container.id)

      try {
        const page = await confluenceGet(
          baseUrl, token,
          `/rest/api/content/${container.id}`,
          { expand: EXPAND }
        )
        mentionedPages.push(page)
      } catch {
        // Skip pages we can't fetch
      }
    }

    return mentionedPages
  } catch (err) {
    console.error(`[${TOOL}] Mention search unavailable, skipping:`, err.message)
    return []
  }
}

/**
 * Run the brief mode: modified pages + mention pages, deduped.
 * @param {string} baseUrl
 * @param {string} token
 * @param {string[]} spaces
 * @param {string} username
 * @param {number} hours
 * @returns {Promise<{pages: object[], truncated: boolean}>}
 */
async function runBrief(baseUrl, token, spaces, username, hours) {
  const [modifiedResult, mentionedPages] = await Promise.all([
    fetchModifiedPages(baseUrl, token, spaces, hours),
    fetchMentionedPages(baseUrl, token, spaces, username, hours)
  ])

  // Dedup: Q2 (mentioned) takes precedence over Q1 (modified)
  const pageMap = new Map()

  for (const raw of modifiedResult.pages) {
    pageMap.set(raw.id, formatPage(raw, 'modified', baseUrl))
  }
  for (const raw of mentionedPages) {
    const existing = pageMap.get(raw.id)
    pageMap.set(raw.id, { ...(existing ?? formatPage(raw, 'mentioned', baseUrl)), reason: 'mentioned' })
  }

  return {
    pages: Array.from(pageMap.values()),
    truncated: modifiedResult.truncated
  }
}

/**
 * Run the search mode: CQL keyword search across configured spaces.
 * @param {string} baseUrl
 * @param {string} token
 * @param {string[]} spaces
 * @param {string} query
 * @returns {Promise<{pages: object[], truncated: boolean}>}
 */
async function runSearch(baseUrl, token, spaces, query) {
  const spaceClause = `space in (${spaces.map(s => `"${s}"`).join(', ')})`
  const cql = `${spaceClause} AND text ~ "${query.replace(/"/g, '\\"')}" AND type = page ORDER BY lastModified DESC`
  const { results, truncated } = await paginateCql(baseUrl, token, cql)
  return {
    pages: results.map(r => formatPage(r, 'search', baseUrl)),
    truncated
  }
}

async function main() {
  const { mode, query, lookbackHours } = parseArgs()

  const baseUrl = process.env.CONFLUENCE_BASE_URL
  const token = process.env.CONFLUENCE_API_TOKEN

  if (!baseUrl) {
    console.log(JSON.stringify(envelope(TOOL, mode, null, ['CONFLUENCE_BASE_URL not set'])))
    return
  }
  if (!token) {
    console.log(JSON.stringify(envelope(TOOL, mode, null, ['CONFLUENCE_API_TOKEN not set'])))
    return
  }

  // Load config
  let config
  try {
    config = await loadConfig('morning-confluence', 'confluence-spaces.json')
  } catch {
    console.log(JSON.stringify(envelope(TOOL, mode, null, [
      'Confluence config missing or no spaces configured — create skills/morning-confluence/config/confluence-spaces.json'
    ])))
    return
  }

  if (!Array.isArray(config.spaces) || config.spaces.length === 0) {
    console.log(JSON.stringify(envelope(TOOL, mode, null, [
      'Confluence config missing or no spaces configured — add spaces to confluence-spaces.json'
    ])))
    return
  }

  const effectiveHours = config.lookback_hours_override ?? lookbackHours

  // Network probe — re-throws network errors before any CQL queries
  let currentUser
  try {
    currentUser = await confluenceGet(baseUrl, token, '/rest/api/user/current')
  } catch (err) {
    if (err.status === 401) {
      console.log(JSON.stringify(envelope(TOOL, mode, null, ['Confluence auth failed — check CONFLUENCE_API_TOKEN in .env'])))
      return
    }
    if (!err.status) {
      const msg = err.message?.toLowerCase().includes('certificate')
        ? 'Confluence SSL error — certificate could not be verified. Are you on VPN?'
        : 'Confluence unreachable — are you on VPN?'
      console.log(JSON.stringify(envelope(TOOL, mode, null, [msg])))
      return
    }
    // Other HTTP errors — log and continue
    console.error(`[${TOOL}] User probe failed: ${err.message}`)
  }

  const username = currentUser?.username ?? currentUser?.displayName ?? ''

  try {
    let data
    if (mode === 'search') {
      if (!query) {
        console.log(JSON.stringify(envelope(TOOL, mode, null, ['--search requires a query string'])))
        return
      }
      data = await runSearch(baseUrl, token, config.spaces, query)
    } else {
      data = await runBrief(baseUrl, token, config.spaces, username, effectiveHours)
    }

    console.log(JSON.stringify(envelope(TOOL, mode, data)))
  } catch (err) {
    if (err.status === 401) {
      console.log(JSON.stringify(envelope(TOOL, mode, null, ['Confluence auth failed — check CONFLUENCE_API_TOKEN in .env'])))
      return
    }
    if (!err.status) {
      const msg = err.message?.toLowerCase().includes('certificate')
        ? 'Confluence SSL error — certificate could not be verified. Are you on VPN?'
        : 'Confluence unreachable — are you on VPN?'
      console.log(JSON.stringify(envelope(TOOL, mode, null, [msg])))
      return
    }
    console.error(`[${TOOL}]`, err.message)
    console.log(JSON.stringify(envelope(TOOL, mode, null, [err.message])))
  }
}

main().catch(err => {
  console.error(`[${TOOL}]`, err.message)
  console.log(JSON.stringify(envelope(TOOL, 'brief', null, [err.message])))
})
