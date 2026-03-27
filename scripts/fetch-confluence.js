#!/usr/bin/env node

/**
 * fetch-confluence.js — Confluence DC REST API → JSON
 *
 * Modes:
 *   --brief              Lookback scan: recently updated pages in watched spaces
 *   --search "query"     Deep Dive: CQL search by keyword
 *   --context <pageId>   Fetch page with all comments (for draft enrichment)
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
 * Fetch body.storage for a specific version of a page.
 * @param {string} baseUrl
 * @param {string} token
 * @param {string} pageId
 * @param {number} version
 * @returns {Promise<string>} Plain text content (HTML stripped)
 */
async function fetchVersionBody(baseUrl, token, pageId, version) {
  const page = await confluenceGet(baseUrl, token, `/rest/api/content/${pageId}`, {
    version,
    expand: 'body.storage',
    status: version > 0 ? 'historical' : undefined,
  })
  return stripHtml(page.body?.storage?.value ?? '')
}

/**
 * Compute a simple text diff summary between two versions.
 * Returns character counts and a human-readable summary.
 * @param {string} oldText - Previous version text (stripped)
 * @param {string} newText - Current version text (stripped)
 * @returns {{ addedChars: number, removedChars: number, totalChange: number, summary: string }}
 */
function computeChangeSummary(oldText, newText) {
  const oldLen = oldText.length
  const newLen = newText.length
  const lenDiff = newLen - oldLen

  // Simple word-level diff for summary
  const oldWords = new Set(oldText.toLowerCase().split(/\s+/).filter(Boolean))
  const newWords = new Set(newText.toLowerCase().split(/\s+/).filter(Boolean))
  const addedWords = [...newWords].filter(w => !oldWords.has(w))
  const removedWords = [...oldWords].filter(w => !newWords.has(w))

  const addedChars = Math.max(0, lenDiff)
  const removedChars = Math.max(0, -lenDiff)
  const totalChange = Math.abs(lenDiff) + Math.min(addedWords.length, removedWords.length) * 5

  let summary
  if (addedWords.length === 0 && removedWords.length === 0) {
    summary = 'minor formatting/whitespace change'
  } else if (removedWords.length === 0) {
    summary = `added ~${addedWords.length} new words (+${newLen - oldLen} chars)`
  } else if (addedWords.length === 0) {
    summary = `removed ~${removedWords.length} words (${oldLen - newLen} chars)`
  } else {
    summary = `~${addedWords.length} words added, ~${removedWords.length} removed (net ${lenDiff > 0 ? '+' : ''}${lenDiff} chars)`
  }

  return { addedChars, removedChars, totalChange, summary }
}

/**
 * Enrich pages with version diff summaries. Fetches previous version body
 * for each page and computes change stats. Pages at version 1 get no diff.
 * @param {string} baseUrl
 * @param {string} token
 * @param {object[]} pages - Formatted page objects
 * @param {number} maxPages - Max pages to fetch diffs for
 * @returns {Promise<object[]>} Pages with `changeSummary` added
 */
async function enrichWithDiffs(baseUrl, token, pages, maxPages = 15) {
  const toEnrich = pages.filter(p => p.version && p.version > 1).slice(0, maxPages)
  const skipped = pages.filter(p => !p.version || p.version <= 1)

  // Mark new pages (version 1)
  for (const p of skipped) {
    p.changeSummary = p.version === 1 ? 'new page' : null
    p.totalChange = Infinity // always surface new pages
  }

  // Fetch diffs in parallel
  const enriched = await Promise.all(toEnrich.map(async (page) => {
    try {
      const [currentText, prevText] = await Promise.all([
        fetchVersionBody(baseUrl, token, page.id, page.version),
        fetchVersionBody(baseUrl, token, page.id, page.version - 1),
      ])
      const diff = computeChangeSummary(prevText, currentText)
      return { ...page, changeSummary: diff.summary, totalChange: diff.totalChange }
    } catch (err) {
      console.error(`[${TOOL}] Diff failed for page ${page.id} (${page.title}): ${err.message}`)
      return { ...page, changeSummary: null, totalChange: Infinity } // surface on error
    }
  }))

  // Pages beyond maxPages limit — no diff, always surface
  const remaining = pages
    .filter(p => p.version && p.version > 1)
    .slice(maxPages)
    .map(p => ({ ...p, changeSummary: null, totalChange: Infinity }))

  return [...enriched, ...skipped, ...remaining]
}

/**
 * Decide whether a formatted page should be surfaced in the brief.
 *
 * Never filters @mentioned pages — if the user was mentioned, always surface it.
 *
 * Two config-driven rules (both opt-in via confluence-spaces.json):
 *
 * 1. exclude_title_patterns — regex strings matched against the page title.
 *    Useful for sprint ceremony pages ("Sprint 2026.W15"), auto-generated reports, etc.
 *
 * 2. skip_if_only_mentions + my_context_keywords — cross-product noise filter.
 *    If a page's title+excerpt mentions a "skip" keyword but NONE of the user's
 *    context keywords, it is filtered. If both appear (cross-product discussion),
 *    the page surfaces normally.
 *
 * @param {object} page - Formatted page object (has .title, .excerpt, .reason)
 * @param {object} config - Loaded confluence-spaces.json
 * @returns {boolean} true = keep, false = skip
 */
function filterPage(page, config) {
  // Never suppress @mention pages — user was directly addressed
  if (page.reason === 'mentioned') return true

  const title = page.title ?? ''
  const haystack = `${title} ${page.excerpt ?? ''}`.toLowerCase()

  // Rule 1: exclude by title pattern
  const excludePatterns = config.exclude_title_patterns ?? []
  for (const pattern of excludePatterns) {
    try {
      if (new RegExp(pattern, 'i').test(title)) return false
    } catch {
      // Malformed regex in config — skip rule silently
    }
  }

  // Rule 2: skip if only mentions other products, not the user's context
  const skipKeywords = config.skip_if_only_mentions ?? []
  const myKeywords = config.my_context_keywords ?? []

  if (skipKeywords.length > 0 && myKeywords.length > 0) {
    const mentionsOther = skipKeywords.some(kw => haystack.includes(kw.toLowerCase()))
    const mentionsMine = myKeywords.some(kw => haystack.includes(kw.toLowerCase()))
    if (mentionsOther && !mentionsMine) return false
  }

  return true
}

/**
 * Run the brief mode: modified pages + mention pages, deduped, filtered.
 * @param {string} baseUrl
 * @param {string} token
 * @param {string[]} spaces
 * @param {string} username
 * @param {number} hours
 * @param {object} config - Loaded confluence-spaces.json (for filtering)
 * @returns {Promise<{pages: object[], truncated: boolean}>}
 */
async function runBrief(baseUrl, token, spaces, username, hours, config = {}) {
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

  const allPages = Array.from(pageMap.values())
  const filtered = allPages.filter(page => filterPage(page, config))
  const skippedByRules = allPages.length - filtered.length

  if (skippedByRules > 0) {
    console.error(`[${TOOL}] Filtered out ${skippedByRules} page(s) by config rules (exclude_title_patterns / skip_if_only_mentions)`)
  }

  // Enrich with version diffs and filter trivial changes
  const maxDiffPages = config.max_diff_pages ?? 15
  const minChangeChars = config.min_change_chars ?? 0
  let enriched = filtered

  if (minChangeChars > 0) {
    enriched = await enrichWithDiffs(baseUrl, token, filtered, maxDiffPages)
    const beforeCount = enriched.length
    enriched = enriched.filter(p => {
      // Never filter @mentioned pages
      if (p.reason === 'mentioned') return true
      // Keep pages where diff couldn't be computed
      if (p.totalChange === Infinity) return true
      return p.totalChange >= minChangeChars
    })
    const trivialCount = beforeCount - enriched.length
    if (trivialCount > 0) {
      console.error(`[${TOOL}] Filtered out ${trivialCount} page(s) with trivial changes (< ${minChangeChars} chars)`)
    }
  }

  return {
    pages: enriched,
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

/**
 * Run the context mode: fetch a single page with all comments for draft enrichment.
 * @param {string} baseUrl
 * @param {string} token
 * @param {string} pageId - Confluence page ID
 * @returns {Promise<object>} Full page context with comments
 */
async function runContext(baseUrl, token, pageId) {
  // Fetch page content
  const page = await confluenceGet(baseUrl, token, `/rest/api/content/${pageId}`, {
    expand: 'version,space,body.excerpt,ancestors,body.storage'
  })

  const spaceKey = page.space?.key ?? ''
  const titleSlug = encodeURIComponent((page.title ?? '').replace(/ /g, '+'))
  const url = page._links?.webui
    ? `${baseUrl}${page._links.webui}`
    : `${baseUrl}/display/${spaceKey}/${titleSlug}`

  // Fetch page comments
  let comments = []
  try {
    const commentData = await confluenceGet(baseUrl, token,
      `/rest/api/content/${pageId}/child/comment`,
      { expand: 'body.storage,version', limit: 50 }
    )
    comments = (commentData.results ?? []).map(c => ({
      author: c.version?.by?.displayName ?? c.version?.by?.username ?? 'unknown',
      body: stripHtml(c.body?.storage?.value ?? '').slice(0, 500),
      createdAt: c.version?.when ?? null
    }))
  } catch (err) {
    console.error(`[${TOOL}] Failed to fetch comments for page ${pageId}:`, err.message)
  }

  return {
    id: page.id,
    title: page.title ?? '',
    space: page.space?.name ?? spaceKey,
    spaceKey,
    url,
    lastModifiedBy: page.version?.by?.displayName ?? 'unknown',
    lastModifiedAt: page.version?.when ?? null,
    version: page.version?.number ?? null,
    breadcrumb: buildBreadcrumb(page.ancestors ?? []),
    excerpt: stripHtml(page.body?.excerpt?.value ?? '').slice(0, 500),
    comments
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
    config = await loadConfig('confluence')
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

  // Check for --context mode (not handled by parseArgs)
  const contextIdx = process.argv.indexOf('--context')
  const contextPageId = contextIdx !== -1 ? process.argv[contextIdx + 1] : null

  try {
    let data
    if (contextPageId) {
      data = await runContext(baseUrl, token, contextPageId)
      console.log(JSON.stringify(envelope(TOOL, 'context', data)))
      return
    } else if (mode === 'search') {
      if (!query) {
        console.log(JSON.stringify(envelope(TOOL, mode, null, ['--search requires a query string'])))
        return
      }
      data = await runSearch(baseUrl, token, config.spaces, query)
    } else {
      data = await runBrief(baseUrl, token, config.spaces, username, effectiveHours, config)
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
