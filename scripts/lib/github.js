/**
 * Shared GitHub API helpers for both github.com and corporate GitHub Enterprise.
 * Uses native fetch — no @octokit/rest dependency.
 *
 * Used by: fetch-github-com.js, fetch-github-corp.js
 * Reference: specs/08-github.md
 */

/** Default config used when config file is missing */
export const DEFAULT_CONFIG = {
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
 * @param {string} baseUrl - API base URL (e.g. https://api.github.com)
 * @param {string} token - GitHub PAT
 * @param {string} path - API path (e.g. /notifications)
 * @param {object} [params] - Query string parameters
 * @returns {Promise<{data: any, headers: Headers}>}
 * @throws {Error} On network or HTTP error. HTTP errors have `err.status` set.
 */
export async function githubGet(baseUrl, token, path, params = {}) {
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
 * Parse a GitHub Link header to extract the next page URL.
 * @param {string|null} linkHeader
 * @returns {string|null}
 */
export function parseNextLink(linkHeader) {
  if (!linkHeader) return null
  const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/)
  return match ? match[1] : null
}

/**
 * Strip markdown formatting from a string for readable summaries.
 * @param {string} text
 * @returns {string}
 */
export function stripMarkdown(text) {
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
 * Fetch all unread notifications, paginating through all pages.
 * Does NOT use `since` — fetches all unread regardless of age, then lets
 * the caller filter by date if needed. This avoids missing old unread items.
 * @param {string} baseUrl
 * @param {string} token
 * @returns {Promise<object[]>}
 */
export async function fetchAllNotifications(baseUrl, token) {
  const notifications = []
  let nextUrl = `${baseUrl}/notifications?all=false&per_page=100`

  while (nextUrl) {
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
 * Supports both config key variants (issue_mentions / mentions).
 * Only high-signal reasons pass by default: review requests, mentions,
 * assignments, own PR/issue activity, CI failures.
 * Noisy reasons (subscribed, comment, state_change) are off by default
 * but can be opted in via config.
 * @param {object} n - Raw notification object
 * @param {object} notifConfig - Notification flags from config
 * @returns {boolean}
 */
export function notificationPassesFilter(n, notifConfig) {
  const reason = n.reason
  const type = n.subject?.type

  if (reason === 'review_requested' && notifConfig.prs_to_review) return true
  if (reason === 'author' && type === 'PullRequest' && notifConfig.pr_activity) return true
  if (reason === 'assign' && notifConfig.issues_assigned) return true
  if (reason === 'author' && type === 'Issue' && notifConfig.issues_opened) return true
  // Support both "mentions" and "issue_mentions" config keys
  if ((reason === 'mention' || reason === 'team_mention') && (notifConfig.mentions ?? notifConfig.issue_mentions)) return true
  if (reason === 'ci_activity' && notifConfig.ci_failures) return true
  // Opt-in only — off by default (too noisy for most users)
  if (reason === 'subscribed' && notifConfig.subscribed) return true
  if (reason === 'comment' && notifConfig.comments) return true
  if (reason === 'state_change' && notifConfig.state_changes) return true

  return false
}

/**
 * Enrich a single notification with subject details (PR/Issue body, state, etc.).
 * If enrichment fails, returns title-only fallback.
 * @param {string} baseUrl
 * @param {string} token
 * @param {object} notification - Raw notification object
 * @param {boolean} fetchCi - Whether to fetch CI check runs for PRs
 * @param {string} toolName - Tool name for error logging
 * @returns {Promise<object>}
 */
export async function enrichNotification(baseUrl, token, notification, fetchCi, toolName) {
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
    const subjectApiUrl = notification.subject?.url
    if (!subjectApiUrl) return base

    const subjectPath = subjectApiUrl.startsWith('https://')
      ? new URL(subjectApiUrl).pathname + new URL(subjectApiUrl).search
      : subjectApiUrl

    const { data: subject } = await githubGet(baseUrl, token, subjectPath)
    const htmlUrl = subject.html_url ?? null

    if (base.type === 'PullRequest') {
      base.url = htmlUrl
      base.author = subject.user?.login ?? null
      base.state = subject.merged ? 'merged' : subject.state
      base.isDraft = subject.draft ?? false
      base.body = stripMarkdown(subject.body ?? '').slice(0, 500)

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
            console.error(`[${toolName}] CI check fetch failed for ${base.repo}:`, ciErr.message)
          }
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
    console.error(`[${toolName}] Enrichment failed for notification ${notification.id}:`, err.message)
  }

  return base
}

/**
 * Run brief mode: fetch + filter + enrich notifications.
 * @param {string} baseUrl
 * @param {string} token
 * @param {object} instanceConfig - Config with notifications flags and orgs array
 * @param {string} since - ISO timestamp
 * @param {string} instanceLabel - "github.com" or "corporate"
 * @param {string} toolName - Tool name for error logging
 * @returns {Promise<{instance: string, notifications: object[]}>}
 */
export async function runBrief(baseUrl, token, instanceConfig, since, instanceLabel, toolName) {
  const notifConfig = instanceConfig.notifications ?? DEFAULT_CONFIG.notifications
  const orgs = instanceConfig.orgs ?? []

  // Fetch all unread notifications (no since filter — catches old unread items)
  const raw = await fetchAllNotifications(baseUrl, token)

  let filtered = raw.filter(n => notificationPassesFilter(n, notifConfig))
  if (orgs.length > 0) {
    filtered = filtered.filter(n => orgs.includes(n.repository?.owner?.login))
  }

  const fetchCi = notifConfig.ci_failures ?? false
  const notifications = await Promise.all(
    filtered.map(n => enrichNotification(baseUrl, token, n, fetchCi, toolName))
  )

  return { instance: instanceLabel, notifications }
}

/**
 * Run search mode: search issues/PRs by keyword.
 * @param {string} baseUrl
 * @param {string} token
 * @param {object} instanceConfig - Config with orgs array
 * @param {string} query - Search query string
 * @param {string} instanceLabel - "github.com" or "corporate"
 * @param {string} toolName - Tool name for error logging
 * @returns {Promise<{instance: string, query: string, results: object[]}>}
 */
export async function runSearch(baseUrl, token, instanceConfig, query, instanceLabel, toolName) {
  const orgs = instanceConfig.orgs ?? []
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
        console.error(`[${toolName}] Search failed for org ${org}:`, err.message)
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

  return { instance: instanceLabel, query, results: notifications }
}
