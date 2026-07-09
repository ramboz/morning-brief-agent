/**
 * Shared JIRA DC query helpers — authenticated GET, JQL pagination, comment
 * cleanup, and issue field-mapping. Extracted from fetch-jira.js so other
 * JIRA-consuming scripts (list-inprogress.js) can reuse the same auth + JQL
 * + mapping path without reimplementing it or importing fetch-jira.js itself
 * (which runs its CLI `main()` unconditionally as an import side effect —
 * every script in this project does; see scripts/list-open-prs.js importing
 * from lib/github.js rather than fetch-github-com.js for the same reason).
 *
 * Used by: fetch-jira.js, scripts/list-inprogress.js
 * Reference: specs/06-jira.md, docs/specs/009-open-work-radar/slice-02-jira-inprogress-staleness.md
 */

import { atlassianFetch } from '../atlassianFetch.js'

/** Fields requested on every JQL search. */
export const FIELDS = 'summary,status,priority,assignee,reporter,updated,comment,labels,issuetype,parent'
export const MAX_PAGES = 3
export const PAGE_SIZE = 50
export const MAX_COMMENTS = 3
export const MAX_COMMENT_CHARS = 300
export const MAX_ISSUES = MAX_PAGES * PAGE_SIZE

/**
 * Strip JIRA wiki markup from a comment body.
 * @param {string} text - Raw comment body
 * @returns {string} Cleaned text
 */
export function stripJiraMarkup(text) {
  if (!text) return ''
  return text
    .replace(/\{code[^}]*\}[\s\S]*?\{code\}/gi, '[code block]')
    .replace(/\{noformat[^}]*\}[\s\S]*?\{noformat\}/gi, '[block]')
    .replace(/\[~([^\]]+)\]/g, '@$1')
    .replace(/\{[^}]+\}/g, '')
    .trim()
}

/**
 * Make a GET request to the JIRA REST API with Bearer auth.
 * @param {string} baseUrl - JIRA base URL
 * @param {string} token - PAT token
 * @param {string} path - API path
 * @param {object} [params] - Query string parameters
 * @returns {Promise<object>} Parsed JSON response
 */
export async function jiraGet(baseUrl, token, path, params = {}) {
  const qs = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null)
  ).toString()
  const fullPath = qs ? `${path}?${qs}` : path
  return atlassianFetch(baseUrl, fullPath, token)
}

/**
 * Paginate a JQL search query, up to MAX_PAGES pages.
 * @param {string} baseUrl
 * @param {string} token
 * @param {string} jql
 * @returns {Promise<{issues: object[], truncated: boolean}>}
 */
export async function paginateJql(baseUrl, token, jql) {
  const issues = []
  let startAt = 0
  let truncated = false

  for (let page = 0; page < MAX_PAGES; page++) {
    const data = await jiraGet(baseUrl, token, '/rest/api/2/search', {
      jql,
      startAt,
      maxResults: PAGE_SIZE,
      fields: FIELDS
    })

    issues.push(...(data.issues ?? []))

    if (issues.length >= data.total || data.issues.length < PAGE_SIZE) break

    startAt += PAGE_SIZE

    if (page === MAX_PAGES - 1 && issues.length < data.total) {
      truncated = true
    }
  }

  return { issues, truncated }
}

/**
 * Extract and clean recent comments from an issue.
 * @param {object} issue - Raw JIRA issue object
 * @returns {Array<{author: string, body: string, createdAt: string}>}
 */
export function extractRecentComments(issue) {
  const comments = issue.fields?.comment?.comments ?? []
  return comments
    .slice(-MAX_COMMENTS)
    .map(c => ({
      author: c.author?.displayName ?? c.author?.name ?? 'unknown',
      body: stripJiraMarkup(c.body ?? '').slice(0, MAX_COMMENT_CHARS),
      createdAt: c.created
    }))
}

/**
 * Map a raw JIRA issue to the output shape.
 * @param {object} issue - Raw JIRA issue
 * @param {string} reason - 'assigned' | 'commented' | 'mentioned' | 'search' | 'jql'
 * @param {string} baseUrl - JIRA base URL
 * @returns {object} Formatted issue
 */
export function formatIssue(issue, reason, baseUrl) {
  const f = issue.fields ?? {}
  return {
    key: issue.key,
    summary: f.summary ?? '',
    type: f.issuetype?.name ?? 'Unknown',
    status: f.status?.name ?? 'Unknown',
    priority: f.priority?.name ?? 'Unknown',
    assignedToMe: reason === 'assigned',
    reason,
    labels: f.labels ?? [],
    updatedAt: f.updated,
    recentComments: extractRecentComments(issue),
    url: `${baseUrl}/browse/${issue.key}`
  }
}

/**
 * Build the in-progress JQL (pure, so AC1's no-lookback contract is unit-testable):
 * assigned to the current user, `statusCategory = "In Progress"`, oldest-update-first,
 * and — deliberately — NO `updated >= -Nh` lookback clause.
 * @param {string[]} projects - Validated project keys
 * @returns {string} JQL
 */
export function buildInProgressJql(projects) {
  const projectClause = `project in (${projects.join(', ')})`
  return `${projectClause} AND assignee = currentUser() AND statusCategory = "In Progress" ORDER BY updated ASC`
}

/**
 * Fetch the user's assigned in-progress tickets across configured projects,
 * with NO lookback bound — staleness is exactly what a lookback-bounded scan
 * filters out, so applying one here would defeat the purpose (Assumption A2,
 * spec 009). Queries by `statusCategory` (not a hard-coded status name) so
 * project-specific in-progress statuses (e.g. "In Review") are covered,
 * ordered oldest-update-first.
 *
 * Returns issues mapped through the same `formatIssue` mapper `runBrief` /
 * `runSearch` use in fetch-jira.js — staleness classification happens
 * downstream in lib/jira/staleness.js's `extractInProgress`; this function
 * only fetches + maps fields, it never classifies staleness itself.
 *
 * @param {string} baseUrl
 * @param {string} token
 * @param {string[]} projects - Validated project keys
 * @returns {Promise<{issues: object[], truncated: boolean}>}
 */
export async function runInProgress(baseUrl, token, projects) {
  const jql = buildInProgressJql(projects)
  const { issues, truncated } = await paginateJql(baseUrl, token, jql)
  return {
    issues: issues.map(i => formatIssue(i, 'assigned', baseUrl)),
    truncated
  }
}
