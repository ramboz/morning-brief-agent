/**
 * Shared GitHub API helpers for both github.com and corporate GitHub Enterprise.
 * Uses native fetch — no @octokit/rest dependency.
 *
 * Used by: fetch-github-com.js, fetch-github-corp.js
 * Reference: specs/08-github.md
 */

import { withRetry } from './config.js'

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
 * Standard headers for GitHub API requests.
 * @param {string} token
 * @param {string} [accept]
 * @returns {object}
 */
function apiHeaders(token, accept = 'application/vnd.github+json') {
  return {
    'Authorization': `Bearer ${token}`,
    'Accept': accept,
    'X-GitHub-Api-Version': '2022-11-28'
  }
}

/**
 * Make an authenticated GET request to the GitHub API using native fetch.
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

  return withRetry(async () => {
    const res = await fetch(url, { headers: apiHeaders(token) })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      const err = new Error(`${res.status} ${res.statusText} — ${url}\n${body.slice(0, 200)}`)
      err.status = res.status
      throw err
    }

    const data = await res.json()
    return { data, headers: res.headers }
  }, { label: `github:${path}` })
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
 * Fetch check-run results for a commit and summarize CI status.
 * Read-only (GET). Fault-tolerant: on any error (skipping 404s) logs to stderr
 * and returns empty CI — never throws.
 *
 * @param {string} baseUrl
 * @param {string} token
 * @param {string} owner
 * @param {string} repo
 * @param {string} sha - Commit SHA (typically the PR head)
 * @param {string} toolName - Tool name for error logging
 * @returns {Promise<{ ciStatus: 'failing'|'passing'|null, ciFailures: Array<{ name: string, conclusion: string }> }>}
 */
export async function fetchCiFailures(baseUrl, token, owner, repo, sha, toolName) {
  const result = { ciStatus: null, ciFailures: [] }
  if (!sha) return result

  try {
    const { data: checksData } = await githubGet(
      baseUrl, token,
      `/repos/${owner}/${repo}/commits/${sha}/check-runs`,
      { per_page: 10 }
    )
    const failures = (checksData.check_runs ?? []).filter(
      cr => cr.conclusion === 'failure' || cr.conclusion === 'cancelled'
    )
    if (failures.length > 0) {
      result.ciStatus = 'failing'
      result.ciFailures = failures.map(cr => ({ name: cr.name, conclusion: cr.conclusion }))
    } else if (checksData.check_runs?.length > 0) {
      result.ciStatus = 'passing'
    }
  } catch (ciErr) {
    if (ciErr.status !== 404) {
      console.error(`[${toolName}] CI check fetch failed for ${owner}/${repo}:`, ciErr.message)
    }
  }

  return result
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

    // subject.url is an absolute API URL. On GitHub Enterprise it already
    // includes the base's /api/v3 prefix, so we must strip the whole baseUrl
    // (not just the origin) before githubGet re-prepends it — otherwise the
    // prefix doubles (…/api/v3/api/v3/…) and every enrichment 404s. This
    // mirrors the next-page handling in fetchAllNotifications.
    let subjectPath
    if (subjectApiUrl.startsWith(baseUrl)) {
      subjectPath = subjectApiUrl.slice(baseUrl.length)
    } else if (subjectApiUrl.startsWith('https://')) {
      subjectPath = new URL(subjectApiUrl).pathname + new URL(subjectApiUrl).search
    } else {
      subjectPath = subjectApiUrl
    }

    const { data: subject } = await githubGet(baseUrl, token, subjectPath)
    const htmlUrl = subject.html_url ?? null

    if (base.type === 'PullRequest') {
      base.url = htmlUrl
      base.author = subject.user?.login ?? null
      base.state = subject.merged ? 'merged' : subject.state
      base.isDraft = subject.draft ?? false
      base.body = stripMarkdown(subject.body ?? '').slice(0, 500)

      if (fetchCi && subject.head?.sha) {
        const owner = notification.repository?.owner?.login ?? ''
        const repo = notification.repository?.name ?? ''
        const ci = await fetchCiFailures(baseUrl, token, owner, repo, subject.head.sha, toolName)
        base.ciStatus = ci.ciStatus
        base.ciFailures = ci.ciFailures
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

/**
 * Fetch the user's own open, authored, non-merged pull requests via the
 * GitHub search API — `is:open is:pr author:@me`, scoped to configured orgs
 * (same org-scoping approach as runSearch). Read-only: no PR is modified.
 *
 * Returns the raw search-issue items unmodified; staleness classification
 * and normalization happen downstream in lib/github/open-prs.js's
 * extractOpenPrs — this function only fetches.
 *
 * @param {string} baseUrl
 * @param {string} token
 * @param {object} instanceConfig - Config with an `orgs` array
 * @param {string} instanceLabel - "github.com" or "corporate"
 * @param {string} toolName - Tool name for error logging
 * @returns {Promise<{ instance: string, prs: object[], errors: string[] }>}
 * @throws {Error} Only when EVERY query fails (total instance failure) — the
 *   caller (gatherSurface) then classifies it as auth/VPN/unreachable. A
 *   partial failure (one org of several) is tolerated: surviving orgs' PRs are
 *   returned and the failed org is reported in the `errors` array.
 */
export async function runOpenPrs(baseUrl, token, instanceConfig, instanceLabel, toolName) {
  const orgs = instanceConfig.orgs ?? []
  // One search query per configured org (org-scoped), or a single unscoped
  // query when no orgs are configured. per_page is capped at 50 with no Link
  // pagination — sufficient for a personal stale-PR view; revisit if slice
  // 009-03's full Monday inventory needs to page a heavy multi-PR account.
  const queries = orgs.length > 0
    ? orgs.map(org => ({ scope: `org ${org}`, q: `is:open is:pr author:@me org:${org}` }))
    : [{ scope: 'search', q: 'is:open is:pr author:@me' }]

  const items = []
  const errors = []
  let firstError = null

  for (const { scope, q } of queries) {
    try {
      const { data } = await githubGet(baseUrl, token, '/search/issues', { q, sort: 'updated', per_page: 50 })
      items.push(...(data.items ?? []))
    } catch (err) {
      if (!firstError) firstError = err
      errors.push(`${instanceLabel}: ${scope} query failed — ${err.message}`)
      console.error(`[${toolName}] ${instanceLabel}: ${scope} query failed:`, err.message)
    }
  }

  // Every query failed → total instance failure. Rethrow so gatherSurface can
  // classify it (auth vs. unreachable). Partial failures fall through with
  // whatever succeeded, plus per-org errors for the caller to surface.
  if (errors.length === queries.length && firstError) throw firstError

  console.error(`[${toolName}] ${instanceLabel}: found ${items.length} open authored PR(s)`)
  return { instance: instanceLabel, prs: items, errors }
}

/**
 * Make an authenticated POST request to the GitHub API.
 * @param {string} baseUrl
 * @param {string} token
 * @param {string} path - API path (e.g. /repos/owner/repo/pulls/1/reviews)
 * @param {object} body - JSON body
 * @returns {Promise<{data: any, headers: Headers}>}
 * @throws {Error} On network or HTTP error
 */
export async function githubPost(baseUrl, token, path, body) {
  const url = `${baseUrl}${path}`

  return withRetry(async () => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { ...apiHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      const err = new Error(`${res.status} ${res.statusText} — ${url}\n${text.slice(0, 200)}`)
      err.status = res.status
      throw err
    }

    const data = await res.json()
    return { data, headers: res.headers }
  }, { label: `github:POST:${path}` })
}

/**
 * Create a PENDING PR review via the GitHub API.
 *
 * SAFETY INVARIANT: this posts a BODY-ONLY payload — no `event`, no `state`,
 * no `comments` decision. With no `event`, GitHub creates a PENDING review
 * that is invisible to others until the human clicks "Submit review". A review
 * is therefore NEVER submitted, approved, changes-requested, merged, or pushed
 * by this helper (ADR-0007, spec 005-03 AC2).
 *
 * Reuses githubPost — does not reimplement auth/POST.
 *
 * @param {{ baseUrl: string, token: string, owner: string, repo: string, number: number|string, body: string, toolName?: string }} args
 * @returns {Promise<{ staged: true, reviewId: number, owner: string, repo: string, number: number|string }>}
 * @throws {Error} On network or HTTP error (caller must catch to preserve the local artifact)
 */
export async function stagePendingReview({ baseUrl, token, owner, repo, number, body, toolName = 'github' }) {
  console.error(`[${toolName}] Creating PENDING review for ${owner}/${repo}#${number} (body-only, never submitted)`)
  const { data } = await githubPost(
    baseUrl, token,
    `/repos/${owner}/${repo}/pulls/${number}/reviews`,
    { body }
  )
  return { staged: true, reviewId: data.id, owner, repo, number }
}

/**
 * Normalize an `instance` field into the corporate/.com contract used by every
 * GitHub stager. Single source of truth so the two staging CLIs can't drift on
 * what counts as "corporate". Pure — no network/fs/env.
 * @param {string} [instance] - "com" | "github.com" | "corp" | "corporate"
 * @returns {{ isCorp: boolean, configKey: 'github_corp'|'github_com' }}
 */
export function resolveInstance(instance) {
  const isCorp = instance === 'corp' || instance === 'corporate'
  return { isCorp, configKey: isCorp ? 'github_corp' : 'github_com' }
}

/**
 * Fetch raw diff for a pull request.
 * @param {string} baseUrl
 * @param {string} token
 * @param {string} owner
 * @param {string} repo
 * @param {number} prNumber
 * @returns {Promise<string>} Unified diff text
 */
export async function fetchPrDiff(baseUrl, token, owner, repo, prNumber) {
  const url = `${baseUrl}/repos/${owner}/${repo}/pulls/${prNumber}`
  const res = await fetch(url, {
    headers: apiHeaders(token, 'application/vnd.github.diff')
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    const err = new Error(`${res.status} ${res.statusText} — diff fetch\n${text.slice(0, 200)}`)
    err.status = res.status
    throw err
  }

  return res.text()
}

/**
 * Fetch review comments on a PR (not issue comments — these are inline on the diff).
 * @param {string} baseUrl
 * @param {string} token
 * @param {string} owner
 * @param {string} repo
 * @param {number} prNumber
 * @returns {Promise<object[]>}
 */
export async function fetchPrReviewComments(baseUrl, token, owner, repo, prNumber) {
  try {
    const { data } = await githubGet(baseUrl, token,
      `/repos/${owner}/${repo}/pulls/${prNumber}/comments`, { per_page: 50 })
    return data
  } catch {
    return []
  }
}

/**
 * Fetch issue/PR comments (conversation tab comments, not inline diff comments).
 * @param {string} baseUrl
 * @param {string} token
 * @param {string} owner
 * @param {string} repo
 * @param {number} issueNumber
 * @returns {Promise<object[]>}
 */
export async function fetchIssueComments(baseUrl, token, owner, repo, issueNumber) {
  try {
    const { data } = await githubGet(baseUrl, token,
      `/repos/${owner}/${repo}/issues/${issueNumber}/comments`, { per_page: 50 })
    return data
  } catch {
    return []
  }
}

/**
 * Parse linked issue/ticket references from a PR body or title.
 * Supports: Fix #123, Closes #123, Resolves #123, PROJ-123 (JIRA-style)
 * Bare `#123` references are returned with owner/repo undefined; the caller
 * defaults them to the PR's own repo (see fetchPrContext).
 * @param {string} text - PR body or title
 * @returns {{ github: Array<{owner: string|undefined, repo: string|undefined, number: number}>, jira: string[] }}
 */
export function parseLinkedIssues(text) {
  if (!text) return { github: [], jira: [] }

  const github = []
  const jira = []

  // GitHub: Fix #123, Closes #123, Resolves #123, fixes org/repo#123
  const ghPattern = /(?:fix(?:es|ed)?|close[sd]?|resolve[sd]?)\s+(?:([a-z0-9_.-]+)\/([a-z0-9_.-]+))?#(\d+)/gi
  let match
  while ((match = ghPattern.exec(text)) !== null) {
    github.push({
      owner: match[1] || null,
      repo: match[2] || null,
      number: parseInt(match[3], 10)
    })
  }

  // JIRA: PROJ-123 style keys (at least 2 uppercase letters, dash, digits)
  const jiraPattern = /\b([A-Z]{2,}-\d+)\b/g
  while ((match = jiraPattern.exec(text)) !== null) {
    if (!jira.includes(match[1])) jira.push(match[1])
  }

  return { github, jira }
}

/**
 * Fetch full context for a PR — diff, description, comments, reviews, linked issues.
 * Used for generating draft PR reviews.
 * @param {string} baseUrl
 * @param {string} token
 * @param {string} owner
 * @param {string} repo
 * @param {number} prNumber
 * @param {string} toolName
 * @returns {Promise<object>}
 */
export async function fetchPrContext(baseUrl, token, owner, repo, prNumber, toolName) {
  console.error(`[${toolName}] Fetching PR context for ${owner}/${repo}#${prNumber}`)

  // Fetch PR details, diff, review comments, and conversation comments in parallel
  const [prResult, diff, reviewComments, issueComments] = await Promise.all([
    githubGet(baseUrl, token, `/repos/${owner}/${repo}/pulls/${prNumber}`),
    fetchPrDiff(baseUrl, token, owner, repo, prNumber),
    fetchPrReviewComments(baseUrl, token, owner, repo, prNumber),
    fetchIssueComments(baseUrl, token, owner, repo, prNumber)
  ])

  const pr = prResult.data
  const linked = parseLinkedIssues(`${pr.title ?? ''} ${pr.body ?? ''}`)

  // CI check-runs need pr.head.sha, so they run after the PR object resolves,
  // in parallel with the linked-issue fetches below. Fault-tolerant (never throws).
  const ciPromise = fetchCiFailures(baseUrl, token, owner, repo, pr.head?.sha, toolName)

  // Fetch linked GitHub issues (same repo only for #N references)
  const linkedIssues = []
  for (const ref of linked.github) {
    const refOwner = ref.owner || owner
    const refRepo = ref.repo || repo
    try {
      const { data } = await githubGet(baseUrl, token,
        `/repos/${refOwner}/${refRepo}/issues/${ref.number}`)
      linkedIssues.push({
        number: ref.number,
        owner: refOwner,
        repo: refRepo,
        title: data.title,
        state: data.state,
        body: stripMarkdown(data.body ?? '').slice(0, 500),
        url: data.html_url
      })
    } catch (err) {
      console.error(`[${toolName}] Could not fetch linked issue ${refOwner}/${refRepo}#${ref.number}: ${err.message}`)
    }
  }

  const ci = await ciPromise

  return {
    type: 'PullRequest',
    owner,
    repo,
    number: prNumber,
    title: pr.title,
    author: pr.user?.login,
    state: pr.merged ? 'merged' : pr.state,
    isDraft: pr.draft ?? false,
    url: pr.html_url,
    body: pr.body ?? '',
    ciStatus: ci.ciStatus,
    ciFailures: ci.ciFailures,
    diff,
    diffStat: {
      additions: pr.additions ?? 0,
      deletions: pr.deletions ?? 0,
      changedFiles: pr.changed_files ?? 0
    },
    baseBranch: pr.base?.ref,
    headBranch: pr.head?.ref,
    reviewComments: reviewComments.map(c => ({
      author: c.user?.login,
      body: c.body?.slice(0, 500),
      path: c.path,
      line: c.line ?? c.original_line,
      createdAt: c.created_at
    })),
    conversationComments: issueComments.map(c => ({
      author: c.user?.login,
      body: c.body?.slice(0, 500),
      createdAt: c.created_at
    })),
    linkedIssues,
    linkedJiraKeys: linked.jira
  }
}

/**
 * Fetch full context for an issue — body, comments, labels.
 * Used for generating draft issue comment replies.
 * @param {string} baseUrl
 * @param {string} token
 * @param {string} owner
 * @param {string} repo
 * @param {number} issueNumber
 * @param {string} toolName
 * @returns {Promise<object>}
 */
export async function fetchIssueContext(baseUrl, token, owner, repo, issueNumber, toolName) {
  console.error(`[${toolName}] Fetching issue context for ${owner}/${repo}#${issueNumber}`)

  const [issueResult, comments] = await Promise.all([
    githubGet(baseUrl, token, `/repos/${owner}/${repo}/issues/${issueNumber}`),
    fetchIssueComments(baseUrl, token, owner, repo, issueNumber)
  ])

  const issue = issueResult.data
  return {
    type: 'Issue',
    owner,
    repo,
    number: issueNumber,
    title: issue.title,
    author: issue.user?.login,
    state: issue.state,
    url: issue.html_url,
    body: issue.body ?? '',
    labels: (issue.labels ?? []).map(l => l.name),
    assignees: (issue.assignees ?? []).map(a => a.login),
    comments: comments.map(c => ({
      author: c.user?.login,
      body: c.body?.slice(0, 500),
      createdAt: c.created_at
    }))
  }
}

/**
 * Run context mode: fetch enriched context for a specific PR or issue.
 * @param {string} baseUrl
 * @param {string} token
 * @param {string} owner
 * @param {string} repo
 * @param {string} type - 'pr' or 'issue'
 * @param {number} number - PR or issue number
 * @param {string} instanceLabel
 * @param {string} toolName
 * @returns {Promise<object>}
 */
export async function runContext(baseUrl, token, owner, repo, type, number, instanceLabel, toolName) {
  if (type === 'pr') {
    return fetchPrContext(baseUrl, token, owner, repo, number, toolName)
  } else {
    return fetchIssueContext(baseUrl, token, owner, repo, number, toolName)
  }
}
