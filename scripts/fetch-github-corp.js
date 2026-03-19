#!/usr/bin/env node

/**
 * fetch-github-corp.js — Corporate GitHub Enterprise API → JSON
 *
 * Uses native fetch only — no @octokit/rest dependency.
 *
 * Modes:
 *   --brief              Lookback scan: notifications, PR review requests
 *   --search "query"     Deep Dive: search PRs/issues by keyword
 *
 * Standalone: node scripts/fetch-github-corp.js --brief
 * Reference:  specs/08-github.md
 */

import dotenv from 'dotenv'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs, loadConfig, envelope } from './lib/config.js'

dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), '.env') })

const TOOL = 'github_corp'

/** Default config used when config file is missing */
const DEFAULT_CONFIG = {
  notifications: {
    prs_to_review: true,
    pr_activity: true,
    issues_assigned: true,
    issues_opened: true,
    mentions: true,
    ci_failures: true
  },
  orgs: []
}

/**
 * Make an authenticated request to the GitHub API using native fetch.
 * @param {string} baseUrl - API base URL (e.g. https://github.corp.com/api/v3)
 * @param {string} token - GitHub PAT
 * @param {string} path - API path (e.g. /notifications)
 * @param {object} [params] - Query string parameters
 * @returns {Promise<{data: any, headers: Headers}>} Parsed JSON and response headers
 * @throws {Error} On network or HTTP error. HTTP errors have `err.status` set.
 */
async function githubGet(baseUrl, token, path, params = {}) {
  const qs = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null)
  ).toString()
  const url = `${baseUrl}${path}${qs ? '?' + qs : ''}`

  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    }
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    const err = new Error(`${res.status} ${res.statusText} — ${url}\n${body.slice(0, 200)}`)
    err.status = res.status
    throw err
  }

  const data = await res.json()
  return { data, headers: res.headers }
}

/**
 * Parse a GitHub Link header to extract the next page URL path+query.
 * @param {string|null} linkHeader - Value of the Link response header
 * @returns {string|null} The next page URL or null
 */
function parseNextLink(linkHeader) {
  if (!linkHeader) return null
  const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/)
  return match ? match[1] : null
}

/**
 * Strip markdown formatting from a string.
 * @param {string} text - Raw markdown text
 * @returns {string} Cleaned plain text
 */
function stripMarkdown(text) {
  if (!text) return ''
  return text
    .replace(/```[\s\S]*?```/g, '[code block]')
    .replace(/`[^`]+`/g, (m) => m.slice(1, -1))
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^#+\s+/gm, '')
    .replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/g, '$1')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Fetch all notifications since a given time, paginating through all pages.
 * @param {string} baseUrl
 * @param {string} token
 * @param {string} since - ISO timestamp
 * @returns {Promise<object[]>} Array of raw notification objects
 */
async function fetchAllNotifications(baseUrl, token, since) {
  const notifications = []
  let nextUrl = `${baseUrl}/notifications?all=false&since=${since}&per_page=100`

  while (nextUrl) {
    // Strip baseUrl prefix if present so we can call githubGet consistently
    const path = nextUrl.startsWith(baseUrl) ? nextUrl.slice(baseUrl.length) : nextUrl
    const { data, headers } = await githubGet(baseUrl, token, path)
    notifications.push(...(Array.isArray(data) ? data : []))
    const linkHeader = headers.get('link')
    const next = parseNextLink(linkHeader)
    nextUrl = next && next !== nextUrl ? next : null
  }

  return notifications
}

/**
 * Determine whether a notification passes the config filter flags.
 * @param {object} n - Raw notification object
 * @param {object} notifConfig - Notification flags from config
 * @returns {boolean}
 */
function notificationPassesFilter(n, notifConfig) {
  const reason = n.reason
  const type = n.subject?.type

  if (reason === 'review_requested' && notifConfig.prs_to_review) return true
  if (reason === 'author' && type === 'PullRequest' && notifConfig.pr_activity) return true
  if (reason === 'assign' && notifConfig.issues_assigned) return true
  if (reason === 'author' && type === 'Issue' && notifConfig.issues_opened) return true
  if ((reason === 'mention' || reason === 'team_mention') && notifConfig.mentions) return true
  if (reason === 'ci_activity' && notifConfig.ci_failures) return true

  return false
}

/**
 * Enrich a single notification with subject details (PR/Issue body, state, etc.).
 * Wraps in try/catch — if enrichment fails, returns title only.
 * @param {string} baseUrl
 * @param {string} token
 * @param {object} notification - Raw notification object
 * @param {boolean} fetchCi - Whether to fetch CI check runs for PRs
 * @returns {Promise<object>} Enriched notification
 */
async function enrichNotification(baseUrl, token, notification, fetchCi) {
  const base = {
    id: notification.id,
    type: notification.subject?.type ?? 'Unknown',
    reason: notification.reason,
    repo: notification.repository?.full_name ?? '',
    title: notification.subject?.title ?? '',
    url: null,
    author: null,
    state: null,
    isDraft: false,
    updatedAt: notification.updated_at,
    ciStatus: null,
    ciFailures: [],
    labels: [],
    body: null
  }

  try {
    // Subject URL is in API format — resolve against baseUrl if it's an absolute URL
    const subjectApiUrl = notification.subject?.url
    if (!subjectApiUrl) return base

    // Make the URL relative to baseUrl
    const subjectPath = subjectApiUrl.startsWith('https://')
      ? new URL(subjectApiUrl).pathname + new URL(subjectApiUrl).search
      : subjectApiUrl

    const { data: subject } = await githubGet(baseUrl, token, subjectPath)

    // Build the HTML URL from the API URL pattern
    const htmlUrl = subject.html_url ?? null

    if (base.type === 'PullRequest') {
      const body = stripMarkdown(subject.body ?? '').slice(0, 500)
      base.url = htmlUrl
      base.author = subject.user?.login ?? null
      base.state = subject.merged ? 'merged' : subject.state
      base.isDraft = subject.draft ?? false
      base.body = body

      // CI failures for PRs
      if (fetchCi && subject.head?.sha) {
        try {
          const owner = notification.repository?.owner?.login ?? ''
          const repo = notification.repository?.name ?? ''
          const { data: checksData } = await githubGet(
            baseUrl, token,
            `/repos/${owner}/${repo}/commits/${subject.head.sha}/check-runs`,
            { per_page: 10 }
          )
          const failures = (checksData.check_runs ?? []).filter(
            cr => cr.conclusion === 'failure' || cr.conclusion === 'cancelled'
          )
          if (failures.length > 0) {
            base.ciStatus = 'failing'
            base.ciFailures = failures.map(cr => ({ name: cr.name, conclusion: cr.conclusion }))
          } else if (checksData.check_runs?.length > 0) {
            base.ciStatus = 'passing'
          }
        } catch (ciErr) {
          if (ciErr.status !== 404) {
            console.error(`[${TOOL}] CI check fetch failed for ${base.repo}:`, ciErr.message)
          }
          // 404 = no CI configured, skip silently
        }
      }
    } else if (base.type === 'Issue') {
      base.url = htmlUrl
      base.author = subject.user?.login ?? null
      base.state = subject.state
      base.labels = (subject.labels ?? []).map(l => l.name)
      base.body = stripMarkdown(subject.body ?? '').slice(0, 500)
    } else {
      base.url = htmlUrl
    }
  } catch (err) {
    console.error(`[${TOOL}] Enrichment failed for notification ${notification.id}:`, err.message)
    // Fall through with title-only base object
  }

  return base
}

/**
 * Run the brief mode: fetch + filter + enrich notifications.
 * @param {string} baseUrl
 * @param {string} token
 * @param {object} corpConfig - Config with notifications flags and orgs array
 * @param {string} since - ISO timestamp
 * @returns {Promise<{instance: string, notifications: object[]}>}
 */
async function runBrief(baseUrl, token, corpConfig, since) {
  const notifConfig = corpConfig.notifications ?? DEFAULT_CONFIG.notifications
  const orgs = corpConfig.orgs ?? []

  const raw = await fetchAllNotifications(baseUrl, token, since)

  // Filter by config flags and org
  let filtered = raw.filter(n => notificationPassesFilter(n, notifConfig))
  if (orgs.length > 0) {
    filtered = filtered.filter(n => orgs.includes(n.repository?.owner?.login))
  }

  const fetchCi = notifConfig.ci_failures ?? false
  const notifications = await Promise.all(
    filtered.map(n => enrichNotification(baseUrl, token, n, fetchCi))
  )

  return { instance: 'corporate', notifications }
}

/**
 * Run the search mode: search issues/PRs by keyword.
 * @param {string} baseUrl
 * @param {string} token
 * @param {object} corpConfig - Config with orgs array
 * @param {string} query - Search query string
 * @returns {Promise<{instance: string, notifications: object[]}>}
 */
async function runSearch(baseUrl, token, corpConfig, query) {
  const orgs = corpConfig.orgs ?? []
  const results = []

  if (orgs.length > 0) {
    for (const org of orgs) {
      try {
        const { data } = await githubGet(baseUrl, token, '/search/issues', {
          q: `${query} org:${org}`,
          sort: 'updated',
          per_page: 20
        })
        results.push(...(data.items ?? []))
      } catch (err) {
        console.error(`[${TOOL}] Search failed for org ${org}:`, err.message)
      }
    }
  } else {
    const { data } = await githubGet(baseUrl, token, '/search/issues', {
      q: query,
      sort: 'updated',
      per_page: 20
    })
    results.push(...(data.items ?? []))
  }

  const notifications = results.map(item => ({
    id: String(item.id),
    type: item.pull_request ? 'PullRequest' : 'Issue',
    reason: 'search',
    repo: item.repository_url?.replace(/.*\/repos\//, '') ?? '',
    title: item.title ?? '',
    url: item.html_url ?? null,
    author: item.user?.login ?? null,
    state: item.state,
    isDraft: item.draft ?? false,
    updatedAt: item.updated_at,
    ciStatus: null,
    ciFailures: [],
    labels: (item.labels ?? []).map(l => l.name),
    body: stripMarkdown(item.body ?? '').slice(0, 500)
  }))

  return { instance: 'corporate', notifications }
}

async function main() {
  const { mode, query, lookbackHours } = parseArgs()

  const baseUrl = process.env.GITHUB_CORP_BASE_URL
  const token = process.env.GITHUB_CORP_TOKEN

  if (!baseUrl) {
    console.log(JSON.stringify(envelope(TOOL, mode, null, ['Corporate GitHub base URL not configured — set GITHUB_CORP_BASE_URL in .env'])))
    return
  }
  if (!token) {
    console.log(JSON.stringify(envelope(TOOL, mode, null, ['GitHub token missing/invalid — check GITHUB_CORP_TOKEN in .env'])))
    return
  }

  // Load config — optional, use defaults if missing
  let corpConfig = DEFAULT_CONFIG
  try {
    const config = await loadConfig('morning-github', 'github-repos.json')
    corpConfig = config.corporate ?? DEFAULT_CONFIG
  } catch {
    console.error(`[${TOOL}] Config not found, using defaults (all notification types enabled, no org filter)`)
  }

  const since = new Date(Date.now() - lookbackHours * 60 * 60 * 1000).toISOString()

  try {
    let data
    if (mode === 'search') {
      if (!query) {
        console.log(JSON.stringify(envelope(TOOL, mode, null, ['--search requires a query string'])))
        return
      }
      data = await runSearch(baseUrl, token, corpConfig, query)
    } else {
      data = await runBrief(baseUrl, token, corpConfig, since)
    }

    console.log(JSON.stringify(envelope(TOOL, mode, data)))
  } catch (err) {
    if (err.status === 401 || err.status === 403) {
      const msg = err.status === 403 && err.message?.includes('rate')
        ? 'GitHub rate limit exceeded'
        : 'GitHub token missing/invalid — check GITHUB_CORP_TOKEN in .env'
      console.log(JSON.stringify(envelope(TOOL, mode, null, [msg])))
      return
    }
    if (!err.status) {
      console.log(JSON.stringify(envelope(TOOL, mode, null, ['Corporate GitHub unreachable — check VPN?'])))
      return
    }
    console.error(`[${TOOL}]`, err.message)
    console.log(JSON.stringify(envelope(TOOL, mode, null, [err.message])))
  }
}

main().catch(err => {
  console.error(`[${TOOL}]`, err.message)
  // Distinguish network vs HTTP errors in top-level catch too
  if (!err.status) {
    console.log(JSON.stringify(envelope(TOOL, 'brief', null, ['Corporate GitHub unreachable — check VPN?'])))
  } else {
    console.log(JSON.stringify(envelope(TOOL, 'brief', null, [err.message])))
  }
})
