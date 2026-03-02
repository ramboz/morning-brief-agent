import 'dotenv/config'
import { isDryRun, isMock } from './utils/flags.js'
import { fetchJira } from './sources/jira.js'
import { fetchConfluence } from './sources/confluence.js'
import { summarizeJira, summarizeConfluence } from './ai/summarize.js'
import {
  writeDailyNote,
  renderJiraTickets,
  renderJiraDiscussions,
  renderConfluence,
} from './output/dailyNote.js'

const startTime = Date.now()

const since = new Date(
  Date.now() - parseInt(process.env.LOOKBACK_HOURS ?? '24') * 60 * 60 * 1000
)

console.log(`[index] Morning briefing started (lookback: ${process.env.LOOKBACK_HOURS ?? 24}h)`)
if (isDryRun) console.log('[index] DRY RUN — output goes to ./output/, no vault writes')
if (isMock) console.log('[index] MOCK — reading from tests/fixtures/ instead of live APIs')

// ---------------------------------------------------------------------------
// Step 1: Fetch all sources in parallel
// ---------------------------------------------------------------------------

const [
  jiraResult,
  confluenceResult,
  // TODO: fetchOutlook  — Phase 2 (pending MS Graph admin approval)
  // TODO: fetchSlack    — Phase 4
  // TODO: fetchGithubDotCom, fetchGithubCorp — Phase 6
  // TODO: fetchTeams    — Phase 7 (pending MS Graph admin approval)
] = await Promise.allSettled([
  fetchJira(since),
  fetchConfluence(since),
])

/**
 * Extracts a settled result value, logging errors for rejected promises.
 * @param {{ status: string, value?: object, reason?: Error }} result
 * @param {string} label
 * @returns {{ ok: boolean, data?: object, error?: string }}
 */
function getValue(result, label) {
  if (result.status === 'rejected') {
    console.error(`[index] ${label} fetch threw unexpectedly:`, result.reason?.message)
    return { ok: false, error: result.reason?.message ?? 'Unknown error' }
  }
  const value = result.value
  if (!value.ok) {
    console.error(`[index] ${label} unavailable: ${value.error}`)
  }
  return value
}

const jira = getValue(jiraResult, 'JIRA')
const confluence = getValue(confluenceResult, 'Confluence')

// ---------------------------------------------------------------------------
// Step 2: Summarize with Claude API
// ---------------------------------------------------------------------------

let jiraSummary = { actionRequired: [], updates: [] }
let confluenceSummary = []

if (jira.ok && jira.data.issues.length > 0) {
  console.log(`[index] Summarizing ${jira.data.issues.length} JIRA issues...`)
  jiraSummary = await summarizeJira(jira.data.issues)
} else if (jira.ok) {
  console.log('[index] JIRA: no issues in lookback window')
}

if (confluence.ok && confluence.data.pages.length > 0) {
  console.log(`[index] Summarizing ${confluence.data.pages.length} Confluence pages...`)
  confluenceSummary = await summarizeConfluence(confluence.data.pages)
} else if (confluence.ok) {
  console.log('[index] Confluence: no pages in lookback window')
}

// ---------------------------------------------------------------------------
// Step 3: Build a Map of original JIRA issues for rich rendering
// ---------------------------------------------------------------------------

const issueMap = new Map(
  (jira.ok ? jira.data.issues : []).map(i => [i.key, i])
)

// ---------------------------------------------------------------------------
// Step 4: Render sections to markdown
// ---------------------------------------------------------------------------

const rendered = {}

// JIRA — error state
if (!jira.ok) {
  rendered.jira_tickets = `_JIRA unavailable: ${jira.error}_`
  rendered.jira_discussions = ''
} else if (jira.data.truncated) {
  rendered.jira_tickets = renderJiraTickets(jiraSummary.actionRequired, issueMap)
  rendered.jira_discussions = renderJiraDiscussions(jiraSummary.updates, issueMap) +
    '\n\n_Results truncated — too many updates. Check JIRA directly._'
} else {
  rendered.jira_tickets = renderJiraTickets(jiraSummary.actionRequired, issueMap)
  rendered.jira_discussions = renderJiraDiscussions(jiraSummary.updates, issueMap)
}

// Confluence — error state
if (!confluence.ok) {
  rendered.confluence = `_Confluence unavailable: ${confluence.error}_`
} else {
  rendered.confluence = renderConfluence(confluenceSummary)
  if (confluence.data.truncated) {
    rendered.confluence += '\n\n_Results truncated — too many page updates. Check Confluence directly._'
  }
}

// Action items: JIRA actionRequired items as a flat checklist
// TODO: Phase 8 will add synthesizeActionItems() for cross-source synthesis
const actionItems = jiraSummary.actionRequired.map(item => {
  const issue = issueMap.get(item.key)
  const url = issue?.url ?? ''
  return `- [ ] [JIRA] [${item.key}](${url}) — ${item.summary}`
})
rendered.action_items = actionItems.length > 0 ? actionItems.join('\n') : '_Nothing to report._'

// ---------------------------------------------------------------------------
// Step 5: Write the daily note
// ---------------------------------------------------------------------------

const sources = [jira, confluence].filter(r => r.ok).length
const items = actionItems.length

const result = await writeDailyNote(rendered, { sources, items })

const duration = Date.now() - startTime
console.log(`[index] Briefing complete — ${result.path} (${duration}ms)`)
