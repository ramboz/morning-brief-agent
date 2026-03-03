import 'dotenv/config'
import { isDryRun, isMock } from './utils/flags.js'
import { fetchJira } from './sources/jira.js'
import { fetchConfluence } from './sources/confluence.js'
import { fetchGithubDotCom } from './sources/githubDotCom.js'
import { fetchGithubCorp } from './sources/githubCorp.js'
import { fetchSlack } from './sources/slack.js'
import { summarizeJira, summarizeConfluence, summarizeGithub, summarizeSlackMentions, summarizeSlackThreads, summarizeSlackDMs, summarizeSlackSection } from './ai/summarize.js'
import {
  writeDailyNote,
  renderJiraTickets,
  renderJiraDiscussions,
  renderConfluence,
  renderGithub,
  renderSlackMentions,
  renderSlackThreads,
  renderSlackDMs,
  renderSlackSections,
  renderSlackSection,
  renderSlackOther,
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
  githubComResult,
  githubCorpResult,
  slackResult,
  // TODO: fetchOutlook — Phase 2 (pending MS Graph admin approval)
  // TODO: fetchTeams   — Phase 7 (pending MS Graph admin approval)
] = await Promise.allSettled([
  fetchJira(since),
  fetchConfluence(since),
  fetchGithubDotCom(since),
  fetchGithubCorp(since),
  fetchSlack(since),
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
const githubCom = getValue(githubComResult, 'GitHub.com')
const githubCorp = getValue(githubCorpResult, 'Corporate GitHub')
const slack = getValue(slackResult, 'Slack')

// ---------------------------------------------------------------------------
// Step 2: Summarize with Claude API
// ---------------------------------------------------------------------------

let jiraSummary = { actionRequired: [], updates: [] }
let confluenceSummary = []
let githubComSummary = []
let githubCorpSummary = []
let slackMentionsSummary = []
let slackThreadsSummary = []
let slackDMsSummary = []
const slackSectionSummaries = {} // { sectionName: channelSummaries[] }

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

if (githubCom.ok && githubCom.data.notifications.length > 0) {
  console.log(`[index] Summarizing ${githubCom.data.notifications.length} GitHub.com notifications...`)
  githubComSummary = await summarizeGithub(githubCom.data.notifications, 'github.com')
} else if (githubCom.ok) {
  console.log('[index] GitHub.com: no notifications in lookback window')
}

if (githubCorp.ok && githubCorp.data.notifications.length > 0) {
  console.log(`[index] Summarizing ${githubCorp.data.notifications.length} Corporate GitHub notifications...`)
  githubCorpSummary = await summarizeGithub(githubCorp.data.notifications, 'Corporate GitHub')
} else if (githubCorp.ok) {
  console.log('[index] Corporate GitHub: no notifications in lookback window')
}

if (slack.ok) {
  if (slack.data.mentions.length > 0) {
    console.log(`[index] Summarizing ${slack.data.mentions.length} Slack mentions...`)
    slackMentionsSummary = await summarizeSlackMentions(slack.data.mentions)
  }
  if (slack.data.threadUpdates.length > 0) {
    console.log(`[index] Summarizing ${slack.data.threadUpdates.length} Slack thread updates...`)
    slackThreadsSummary = await summarizeSlackThreads(slack.data.threadUpdates)
  }
  if (slack.data.directMessages.length > 0) {
    console.log(`[index] Summarizing ${slack.data.directMessages.length} Slack DMs...`)
    slackDMsSummary = await summarizeSlackDMs(slack.data.directMessages)
  }
  for (const [sectionName, sectionData] of Object.entries(slack.data.sections)) {
    const channelsWithMessages = sectionData.channels.filter(ch => ch.messages.length > 0)
    if (channelsWithMessages.length > 0) {
      console.log(`[index] Summarizing Slack section: ${sectionName}...`)
      slackSectionSummaries[sectionName] = await summarizeSlackSection(sectionName, sectionData.channels)
    }
  }
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

// GitHub.com
if (!githubCom.ok) {
  rendered.github_com = `_GitHub.com unavailable: ${githubCom.error}_`
} else {
  rendered.github_com = renderGithub(githubComSummary)
}

// Corporate GitHub
if (!githubCorp.ok) {
  rendered.github_corp = `_Corporate GitHub unavailable: ${githubCorp.error}_`
} else {
  rendered.github_corp = renderGithub(githubCorpSummary)
}

// Slack
if (!slack.ok) {
  rendered.slack_mentions = `_Slack unavailable: ${slack.error}_`
  rendered.slack_dms = ''
  rendered.slack_sections_dynamic = ''
  rendered.slack_other = ''
} else {
  rendered.slack_mentions = renderSlackMentions(slackMentionsSummary)
  rendered.slack_threads = renderSlackThreads(slackThreadsSummary)
  rendered.slack_dms = renderSlackDMs(slackDMsSummary)
  rendered.slack_sections_dynamic = renderSlackSections(slackSectionSummaries)
  rendered.slack_other = renderSlackOther(slack.data.otherChannelsActivity)
  // Add individual section keys for smart-merge on re-runs
  for (const [sectionName, channels] of Object.entries(slackSectionSummaries)) {
    rendered[`slack_section_${sectionName}`] = renderSlackSection(channels)
  }
}

// Action items: JIRA actionRequired + GitHub items needing action
// TODO: Phase 8 will add synthesizeActionItems() for cross-source synthesis
const actionItems = [
  ...jiraSummary.actionRequired.map(item => {
    const issue = issueMap.get(item.key)
    const url = issue?.url ?? ''
    return `- [ ] [JIRA] [${item.key}](${url}) — ${item.summary}`
  }),
  ...githubComSummary.filter(n => n.needsAction).map(n =>
    `- [ ] [GitHub] [${n.title}](${n.url}) — ${n.summary}`
  ),
  ...githubCorpSummary.filter(n => n.needsAction).map(n =>
    `- [ ] [GitHub Corp] [${n.title}](${n.url}) — ${n.summary}`
  ),
  ...slackMentionsSummary.filter(m => m.needsReply).map(m =>
    `- [ ] [Slack #${m.channelName}] ${m.user}: ${m.summary}`
  ),
  ...slackThreadsSummary.filter(t => t.needsReply).map(t =>
    `- [ ] [Slack thread #${t.channelName}] ${t.summary}`
  ),
  ...slackDMsSummary.filter(dm => dm.replyExpected).map(dm =>
    `- [ ] [Slack DM] ${dm.withUser}: ${dm.summary}`
  ),
]
rendered.action_items = actionItems.length > 0 ? actionItems.join('\n') : '_Nothing to report._'

// ---------------------------------------------------------------------------
// Step 5: Write the daily note
// ---------------------------------------------------------------------------

const sources = [jira, confluence, githubCom, githubCorp, slack].filter(r => r.ok).length
const items = actionItems.length

const result = await writeDailyNote(rendered, { sources, items })

const duration = Date.now() - startTime
console.log(`[index] Briefing complete — ${result.path} (${duration}ms)`)
