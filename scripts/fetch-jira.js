#!/usr/bin/env node

/**
 * fetch-jira.js — JIRA DC REST API → JSON
 *
 * Modes:
 *   --brief              Lookback scan: assigned tickets, commented, mentioned
 *   --search "query"     Deep Dive: JQL search by keyword
 *   --jql "<query>"      Run arbitrary JQL exactly as provided (bypasses project config validation)
 *   --context SITES-123  Fetch full ticket with all comments (for draft enrichment)
 *
 * Standalone: node scripts/fetch-jira.js --brief
 * Reference:  specs/06-jira.md
 */

import dotenv from 'dotenv'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs, loadConfig, envelope } from './lib/config.js'
import {
  MAX_ISSUES,
  stripJiraMarkup,
  jiraGet,
  paginateJql,
  formatIssue
} from './lib/jira/query.js'

dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), '.env') })

const TOOL = 'jira'

/** @type {RegExp} Valid JIRA project key format */
const PROJECT_KEY_RE = /^[A-Z][A-Z0-9]+$/

/**
 * Run the brief mode: three-pass JQL scan (assigned, commented, mentioned).
 * @param {string} baseUrl
 * @param {string} token
 * @param {string[]} projects - Validated project keys
 * @param {number} hours - Lookback window in hours
 * @returns {Promise<{issues: object[], truncated: boolean}>}
 */
async function runBrief(baseUrl, token, projects, hours) {
  const projectClause = `project in (${projects.join(', ')})`
  const timeClause = `updated >= -${hours}h`

  // Network probe — doubles as accountId fetch (needed for /rest/api/2/myself call elsewhere if required)
  await jiraGet(baseUrl, token, '/rest/api/2/myself')

  const jqlQ1 = `${projectClause} AND assignee = currentUser() AND ${timeClause} ORDER BY updated DESC`
  const jqlQ2sr = `${projectClause} AND issueFunction in commented("by currentUser() after -${hours}h") AND assignee != currentUser() ORDER BY updated DESC`
  const jqlQ2fb = `${projectClause} AND comment ~ currentUser() AND ${timeClause} AND assignee != currentUser() ORDER BY updated DESC`
  // Q3: issues mentioning the current user anywhere in text (summary, description, comments)
  const jqlQ3 = `${projectClause} AND text ~ currentUser() AND ${timeClause} AND assignee != currentUser() ORDER BY updated DESC`

  const [r1, r2, r3] = await Promise.allSettled([
    paginateJql(baseUrl, token, jqlQ1),
    paginateJql(baseUrl, token, jqlQ2sr).catch(async err => {
      // ScriptRunner not available — fall back to comment text search
      if (err.status === 400) {
        console.error(`[${TOOL}] ScriptRunner unavailable, using fallback JQL for comments`)
        return paginateJql(baseUrl, token, jqlQ2fb)
      }
      throw err
    }),
    paginateJql(baseUrl, token, jqlQ3)
  ])

  // Dedup: Q1 wins, then Q2, then Q3
  const seen = new Set()
  const deduped = []
  let truncated = false

  const batches = [
    { result: r1, reason: 'assigned' },
    { result: r2, reason: 'commented' },
    { result: r3, reason: 'mentioned' }
  ]

  for (const { result, reason } of batches) {
    if (result.status === 'rejected') {
      console.error(`[${TOOL}] Query failed (${reason}):`, result.reason?.message)
      continue
    }
    if (result.value.truncated) truncated = true
    for (const issue of result.value.issues) {
      if (seen.has(issue.key)) continue
      seen.add(issue.key)
      deduped.push(formatIssue(issue, reason, baseUrl))
    }
  }

  if (deduped.length >= MAX_ISSUES) truncated = true

  return { issues: deduped, truncated }
}

/**
 * Run the search mode: JQL keyword search across configured projects.
 * @param {string} baseUrl
 * @param {string} token
 * @param {string[]} projects
 * @param {string} query
 * @returns {Promise<{issues: object[], truncated: boolean}>}
 */
async function runSearch(baseUrl, token, projects, query) {
  const projectClause = `project in (${projects.join(', ')})`
  const jql = `${projectClause} AND text ~ "${query.replace(/"/g, '\\"')}" ORDER BY updated DESC`
  const { issues, truncated } = await paginateJql(baseUrl, token, jql)
  return {
    issues: issues.map(i => formatIssue(i, 'search', baseUrl)),
    truncated
  }
}

/**
 * Run the JQL mode: execute the provided JQL string verbatim.
 * Caller is responsible for project clauses, time bounds, and ORDER BY.
 * @param {string} baseUrl
 * @param {string} token
 * @param {string} jql
 * @returns {Promise<{issues: object[], truncated: boolean}>}
 */
async function runJql(baseUrl, token, jql) {
  const { issues, truncated } = await paginateJql(baseUrl, token, jql)
  return {
    issues: issues.map(i => formatIssue(i, 'jql', baseUrl)),
    truncated
  }
}

/**
 * Run the context mode: fetch a single ticket with ALL comments for draft enrichment.
 * @param {string} baseUrl
 * @param {string} token
 * @param {string} ticketKey - e.g. "SITES-38280"
 * @returns {Promise<object>} Full ticket context
 */
async function runContext(baseUrl, token, ticketKey) {
  const allFields = 'summary,status,priority,assignee,reporter,updated,comment,labels,issuetype,parent,description'
  const data = await jiraGet(baseUrl, token, `/rest/api/2/issue/${ticketKey}`, {
    fields: allFields,
    expand: 'renderedFields'
  })

  const f = data.fields ?? {}
  const comments = (f.comment?.comments ?? []).map(c => ({
    author: c.author?.displayName ?? c.author?.name ?? 'unknown',
    body: stripJiraMarkup(c.body ?? ''),
    createdAt: c.created
  }))

  return {
    key: data.key,
    summary: f.summary ?? '',
    description: stripJiraMarkup(f.description ?? '').slice(0, 2000),
    type: f.issuetype?.name ?? 'Unknown',
    status: f.status?.name ?? 'Unknown',
    priority: f.priority?.name ?? 'Unknown',
    assignee: f.assignee?.displayName ?? f.assignee?.name ?? 'Unassigned',
    reporter: f.reporter?.displayName ?? f.reporter?.name ?? 'unknown',
    labels: f.labels ?? [],
    updatedAt: f.updated,
    url: `${baseUrl}/browse/${data.key}`,
    comments
  }
}

async function main() {
  const { mode, query, lookbackHours } = parseArgs()

  const baseUrl = process.env.JIRA_BASE_URL
  const token = process.env.JIRA_API_TOKEN

  if (!baseUrl) {
    console.log(JSON.stringify(envelope(TOOL, mode, null, ['JIRA_BASE_URL not set'])))
    return
  }
  if (!token) {
    console.log(JSON.stringify(envelope(TOOL, mode, null, ['JIRA_API_TOKEN not set'])))
    return
  }

  // --jql mode bypasses project config — caller owns the full JQL
  const jqlIdx = process.argv.indexOf('--jql')
  const jqlOverride = jqlIdx !== -1 ? process.argv[jqlIdx + 1] : null
  if (jqlIdx !== -1 && !jqlOverride) {
    console.log(JSON.stringify(envelope(TOOL, 'jql', null, ['--jql requires a JQL string'])))
    return
  }

  if (jqlOverride) {
    try {
      await jiraGet(baseUrl, token, '/rest/api/2/myself')
    } catch (err) {
      if (err.status === 401) {
        console.log(JSON.stringify(envelope(TOOL, 'jql', null, ['JIRA auth failed — check JIRA_API_TOKEN in .env'])))
        return
      }
      const msg = err.message?.toLowerCase().includes('certificate')
        ? 'JIRA SSL error — certificate could not be verified. Are you on VPN?'
        : (err.status ? err.message : 'JIRA unreachable — are you on VPN?')
      console.log(JSON.stringify(envelope(TOOL, 'jql', null, [msg])))
      return
    }

    try {
      const data = await runJql(baseUrl, token, jqlOverride)
      console.log(JSON.stringify(envelope(TOOL, 'jql', data)))
    } catch (err) {
      console.error(`[${TOOL}]`, err.message)
      console.log(JSON.stringify(envelope(TOOL, 'jql', null, [err.message])))
    }
    return
  }

  // Load config
  let config
  try {
    config = await loadConfig('jira')
  } catch {
    console.log(JSON.stringify(envelope(TOOL, mode, null, [
      'JIRA config missing or no projects configured — create skills/morning-jira/config/jira-filters.json'
    ])))
    return
  }

  if (!Array.isArray(config.projects) || config.projects.length === 0) {
    console.log(JSON.stringify(envelope(TOOL, mode, null, [
      'JIRA config missing or no projects configured — add projects to jira-filters.json'
    ])))
    return
  }

  // Validate project keys
  const validProjects = []
  for (const key of config.projects) {
    if (PROJECT_KEY_RE.test(key)) {
      validProjects.push(key)
    } else {
      console.error(`[${TOOL}] Skipping invalid project key: ${key}`)
    }
  }

  if (validProjects.length === 0) {
    console.log(JSON.stringify(envelope(TOOL, mode, null, ['No valid JIRA project keys in config'])))
    return
  }

  const effectiveHours = config.lookback_hours_override ?? lookbackHours

  try {
    // Network probe — if this throws without a status, we're off VPN
    await jiraGet(baseUrl, token, '/rest/api/2/myself').catch(err => {
      if (!err.status) {
        const vpnErr = new Error(
          err.message?.toLowerCase().includes('certificate')
            ? 'JIRA SSL error — certificate could not be verified. Are you on VPN?'
            : 'JIRA unreachable — are you on VPN?'
        )
        throw vpnErr
      }
      // HTTP error (e.g. 401) — re-throw with status preserved
      throw err
    })
  } catch (err) {
    if (err.status === 401) {
      console.log(JSON.stringify(envelope(TOOL, mode, null, ['JIRA auth failed — check JIRA_API_TOKEN in .env'])))
      return
    }
    if (!err.status) {
      console.log(JSON.stringify(envelope(TOOL, mode, null, [err.message])))
      return
    }
    // Other HTTP errors from the probe — fall through and let individual queries handle
  }

  // Check for --context mode (not handled by parseArgs)
  const contextIdx = process.argv.indexOf('--context')
  const contextKey = contextIdx !== -1 ? process.argv[contextIdx + 1] : null

  try {
    let data
    if (contextKey) {
      data = await runContext(baseUrl, token, contextKey)
      console.log(JSON.stringify(envelope(TOOL, 'context', data)))
      return
    } else if (mode === 'search') {
      if (!query) {
        console.log(JSON.stringify(envelope(TOOL, mode, null, ['--search requires a query string'])))
        return
      }
      data = await runSearch(baseUrl, token, validProjects, query)
    } else {
      data = await runBrief(baseUrl, token, validProjects, effectiveHours)
    }

    console.log(JSON.stringify(envelope(TOOL, mode, data)))
  } catch (err) {
    if (err.status === 401) {
      console.log(JSON.stringify(envelope(TOOL, mode, null, ['JIRA auth failed — check JIRA_API_TOKEN in .env'])))
      return
    }
    if (!err.status) {
      const msg = err.message?.toLowerCase().includes('certificate')
        ? 'JIRA SSL error — certificate could not be verified. Are you on VPN?'
        : 'JIRA unreachable — are you on VPN?'
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
