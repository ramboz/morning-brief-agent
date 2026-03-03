import 'dotenv/config'
import fs from 'fs/promises'
import { fileURLToPath } from 'url'
import { isMock, isSaveFixture, debug } from '../utils/flags.js'

const FIELDS = 'summary,status,priority,assignee,reporter,updated,comment,labels,issuetype,parent'
const MAX_PAGES = 3
const PAGE_SIZE = 50
const MAX_COMMENT_CHARS = 300
const MAX_COMMENTS_PER_ISSUE = 3
const PROJECT_KEY_PATTERN = /^[A-Z][A-Z0-9]+$/

/**
 * Validates a JIRA project key format.
 * @param {string} key
 * @returns {boolean}
 */
function isValidProjectKey(key) {
  return PROJECT_KEY_PATTERN.test(key)
}

/**
 * Loads and validates the JIRA config file.
 * @returns {Promise<{ ok: boolean, config?: object, error?: string }>}
 */
async function loadConfig() {
  const configPath = process.env.JIRA_CONFIG_PATH ?? './config/jira.json'
  let raw
  try {
    raw = await fs.readFile(configPath, 'utf-8')
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { ok: false, error: `JIRA config missing — create ${configPath} from config/jira.example.json` }
    }
    return { ok: false, error: `Failed to read JIRA config: ${err.message}` }
  }

  let config
  try {
    config = JSON.parse(raw)
  } catch {
    return { ok: false, error: 'JIRA config is not valid JSON' }
  }

  if (!Array.isArray(config.projects) || config.projects.length === 0) {
    return { ok: false, error: 'JIRA config missing or no projects configured — create config/jira.json' }
  }

  const validProjects = config.projects.filter(k => {
    if (!isValidProjectKey(k)) {
      console.warn(`[jira] Invalid project key format — skipping: ${k}`)
      return false
    }
    return true
  })

  if (validProjects.length === 0) {
    return { ok: false, error: 'JIRA config has no valid project keys (expected format: A-Z, e.g. ENG)' }
  }

  return {
    ok: true,
    config: {
      projects: validProjects,
      lookback_hours_override: config.lookback_hours_override ?? null,
    },
  }
}

/**
 * Makes an authenticated GET request to the JIRA REST API.
 * @param {string} path - API path relative to JIRA_BASE_URL
 * @param {object} [params] - Query parameters
 * @returns {Promise<object>}
 */
async function jiraFetch(path, params = {}) {
  const baseUrl = process.env.JIRA_BASE_URL
  if (!baseUrl) throw new Error('[jira] JIRA_BASE_URL is not set')

  const token = process.env.JIRA_API_TOKEN
  if (!token) throw new Error('[jira] JIRA_API_TOKEN is not set')

  const url = new URL(`${baseUrl}${path}`)

  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) url.searchParams.set(k, String(v))
  }

  // JIRA DC PATs are Bearer tokens (not Basic Auth credentials).
  // See: https://confluence.atlassian.com/enterprise/using-personal-access-tokens-1026032365.html
  const response = await fetch(url.toString(), {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    const err = new Error(`JIRA API ${response.status}: ${text.slice(0, 200)}`)
    err.status = response.status
    throw err
  }

  return response.json()
}

/**
 * Strips basic JIRA wiki markup from comment body text.
 * @param {string} text
 * @returns {string}
 */
function stripJiraMarkup(text) {
  return text
    .replace(/\{code[^}]*\}[\s\S]*?\{code\}/gi, '[code block]')
    .replace(/\{noformat\}[\s\S]*?\{noformat\}/gi, '[formatted block]')
    .replace(/\[~([^\]]+)\]/g, '@$1')
    .replace(/\{[^}]+\}/g, '')
    .trim()
}

/**
 * Runs a JQL search query, paginating up to MAX_PAGES (150 issues max).
 * @param {string} jql
 * @returns {Promise<{ issues: object[], truncated: boolean }>}
 */
async function runJqlQuery(jql, label = 'query') {
  const allIssues = []
  let startAt = 0
  let truncated = false

  for (let page = 0; page < MAX_PAGES; page++) {
    debug('[jira]', `${label} page ${page + 1}/${MAX_PAGES} (startAt=${startAt})...`)
    const result = await jiraFetch('/rest/api/2/search', {
      jql,
      startAt,
      maxResults: PAGE_SIZE,
      fields: FIELDS,
    })

    const issues = result.issues ?? []
    debug('[jira]', `${label} page ${page + 1}: ${issues.length} issues (${result.total ?? '?'} total)`)
    if (issues.length === 0) break

    allIssues.push(...issues)

    const total = result.total ?? allIssues.length
    if (allIssues.length >= total) break

    if (page === MAX_PAGES - 1 && allIssues.length < total) {
      truncated = true
    }

    startAt += PAGE_SIZE
  }

  return { issues: allIssues, truncated }
}

/**
 * Maps a raw JIRA API issue to the canonical data shape.
 * @param {object} issue - Raw JIRA issue object
 * @param {'assigned'|'commented'|'mentioned'} reason
 * @param {string} baseUrl
 * @returns {object}
 */
function mapIssue(issue, reason, baseUrl) {
  const comments = (issue.fields.comment?.comments ?? [])
    .slice(-MAX_COMMENTS_PER_ISSUE)
    .map(c => ({
      author: c.author?.displayName ?? c.author?.name ?? 'Unknown',
      body: stripJiraMarkup(c.body ?? '').slice(0, MAX_COMMENT_CHARS),
      createdAt: c.created,
    }))

  return {
    key: issue.key,
    summary: issue.fields.summary,
    type: issue.fields.issuetype?.name ?? 'Unknown',
    status: issue.fields.status?.name ?? 'Unknown',
    priority: issue.fields.priority?.name ?? 'Unknown',
    assignedToMe: reason === 'assigned',
    reason,
    labels: issue.fields.labels ?? [],
    updatedAt: issue.fields.updated,
    recentComments: comments,
    url: `${baseUrl}/browse/${issue.key}`,
  }
}

/**
 * Fetches JIRA activity relevant to the current user in the last N hours.
 * Runs three JQL queries in parallel: assigned tickets, commented tickets, mentioned tickets.
 * Deduplicates by issue key, with assigned taking precedence.
 * @param {Date} since - Lookback start time (used for fallback display; JQL uses hours from config)
 * @returns {Promise<{ ok: boolean, data?: { issues: object[], truncated: boolean }, error?: string }>}
 */
export async function fetchJira(_since) {
  if (isMock) {
    try {
      const fixture = JSON.parse(await fs.readFile('tests/fixtures/jira.json', 'utf-8'))
      return fixture
    } catch {
      return { ok: false, error: 'Mock fixture not found: tests/fixtures/jira.json' }
    }
  }

  const configResult = await loadConfig()
  if (!configResult.ok) return { ok: false, error: configResult.error }

  const { config } = configResult
  const baseUrl = process.env.JIRA_BASE_URL
  const hours = config.lookback_hours_override ?? parseInt(process.env.LOOKBACK_HOURS ?? '24')
  const projectClause = `project in (${config.projects.join(', ')})`
  debug('[jira]', `Fetching from ${config.projects.length} projects, lookback ${hours}h`)

  try {
    let mentionTag = null
    try {
      debug('[jira]', 'Fetching current user info...')
      const me = await jiraFetch('/rest/api/2/myself')
      mentionTag = me.name ? `[~${me.name}]` : (me.accountId ? `[~accountId:${me.accountId}]` : null)
      debug('[jira]', `User: ${me.displayName ?? me.name ?? 'unknown'}`)
    } catch (err) {
      if (err.status === 401) throw err
      console.warn('[jira] Could not fetch user info — mention query will be skipped:', err.message)
    }

    const q1 = `${projectClause} AND assignee = currentUser() AND updated >= -${hours}h ORDER BY updated DESC`

    // ScriptRunner JQL: currentUser() works inside issueFunction on DC v9.x, but the
    // inner `after -Nh` time clause does not. Rely on the outer updated filter instead.
    const q2ScriptRunner = `${projectClause} AND assignee != currentUser() AND updated >= -${hours}h AND issueFunction in commented("by currentUser()") ORDER BY updated DESC`
    const q2Fallback = `${projectClause} AND assignee != currentUser() AND updated >= -${hours}h AND comment ~ currentUser() ORDER BY updated DESC`

    const q3 = mentionTag
      ? `${projectClause} AND comment ~ "${mentionTag}" AND updated >= -${hours}h AND assignee != currentUser() ORDER BY updated DESC`
      : null

    debug('[jira]', `Running ${q3 ? 3 : 2} JQL queries in parallel (assigned, commented${q3 ? ', mentioned' : ''})...`)
    const t0 = Date.now()

    const queryPromises = [
      runJqlQuery(q1, 'assigned').then(r => ({ ...r, reason: 'assigned' })),

      runJqlQuery(q2ScriptRunner, 'commented')
        .catch(err => {
          if (err.status === 400) {
            console.log('[jira] ScriptRunner unavailable, using fallback JQL for comments')
            return runJqlQuery(q2Fallback, 'commented')
          }
          throw err
        })
        .then(r => ({ ...r, reason: 'commented' })),
    ]

    if (q3) {
      queryPromises.push(
        runJqlQuery(q3, 'mentioned')
          .catch(err => {
            if (err.status === 400) {
              return { issues: [], truncated: false }
            }
            throw err
          })
          .then(r => ({ ...r, reason: 'mentioned' }))
      )
    }

    const results = await Promise.allSettled(queryPromises)
    debug('[jira]', `JQL queries completed in ${Date.now() - t0}ms`)

    // If any query was rejected due to auth, surface it immediately
    const authFailure = results.find(r => r.status === 'rejected' && r.reason?.status === 401)
    if (authFailure) {
      return { ok: false, error: 'JIRA auth failed — check JIRA_API_TOKEN in .env' }
    }

    // Deduplicate: assigned > commented > mentioned
    const seen = new Set()
    const allIssues = []
    let truncated = false

    for (const result of results) {
      if (result.status === 'rejected') {
        console.error('[jira] A JQL query failed:', result.reason?.message)
        continue
      }
      const { issues, truncated: t, reason } = result.value
      if (t) truncated = true
      for (const issue of issues) {
        if (!seen.has(issue.key)) {
          seen.add(issue.key)
          allIssues.push(mapIssue(issue, reason, baseUrl))
        }
      }
    }

    debug('[jira]', `${allIssues.length} issues after dedup (assigned: ${allIssues.filter(i => i.reason === 'assigned').length}, commented: ${allIssues.filter(i => i.reason === 'commented').length}, mentioned: ${allIssues.filter(i => i.reason === 'mentioned').length})${truncated ? ' [truncated]' : ''}`)

    return { ok: true, data: { issues: allIssues, truncated } }
  } catch (err) {
    if (err.status === 401) {
      return { ok: false, error: 'JIRA auth failed — check JIRA_API_TOKEN in .env' }
    }
    if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
      return { ok: false, error: 'JIRA unreachable — check JIRA_BASE_URL and VPN' }
    }
    return { ok: false, error: `JIRA fetch failed: ${err.message}` }
  }
}

// Standalone runner
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const result = await fetchJira(since)
  console.log(JSON.stringify(result, null, 2))

  if (isSaveFixture) {
    await fs.writeFile('tests/fixtures/jira.json', JSON.stringify(result, null, 2))
    console.log('[jira] Fixture saved to tests/fixtures/jira.json')
  }
}
