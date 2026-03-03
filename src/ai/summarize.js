import 'dotenv/config'
import Anthropic from '@anthropic-ai/sdk'

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('[ai] ANTHROPIC_API_KEY not set — summarization will fail')
}

const MODEL = 'claude-sonnet-4-20250514'
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// ---------------------------------------------------------------------------
// Prompt constants
// ---------------------------------------------------------------------------

const PROMPT_JIRA = `You are summarizing JIRA ticket activity for a morning briefing.

You will receive a JSON array of JIRA issues the user is involved with. Separate them into two groups:
- "actionRequired": tickets where the user needs to take action today (blocked, review requested, question directed at them, status change needing response)
- "updates": tickets with activity worth knowing about but no immediate action needed

For each ticket, write one concise line describing what happened or what action is needed.
Skip issues with no meaningful activity (pure metadata changes, no comments, no status change).

Return JSON only. No markdown, no explanation, no preamble.

Output shape:
{
  "actionRequired": [
    { "key": "ENG-482", "summary": "Review PR — Alice blocked on token refresh edge case" }
  ],
  "updates": [
    { "key": "ENG-410", "summary": "Status changed to In Review by Alice" }
  ]
}`

const PROMPT_CONFLUENCE = `You are summarizing Confluence page activity for a morning briefing.

You will receive a JSON array of recently modified Confluence pages. For each page, write one concise line describing what changed and who changed it. If the user was mentioned ("reason": "mentioned"), note that explicitly.

Skip pages where the excerpt shows only trivial edits (formatting only, single word change, version bump with no content change).

Return JSON only. No markdown, no explanation, no preamble.

Output shape:
[
  {
    "title": "Q1 Engineering Roadmap",
    "space": "ENG",
    "url": "https://...",
    "summary": "Alice added mobile section to Q2 priorities",
    "needsAttention": false
  }
]

Set "needsAttention": true if the user was mentioned or the page is directly relevant to their work.`

// ---------------------------------------------------------------------------
// Shared call wrapper
// ---------------------------------------------------------------------------

/**
 * Calls the Claude API with a system prompt and user content.
 * @param {string} prompt - System prompt
 * @param {string} userContent - User message content
 * @param {number} [maxTokens]
 * @returns {Promise<string>} Raw text response
 */
async function callClaude(prompt, userContent, maxTokens = 1000) {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system: prompt,
    messages: [{ role: 'user', content: userContent }],
  })
  return response.content[0].text
}

// ---------------------------------------------------------------------------
// JIRA
// ---------------------------------------------------------------------------

/**
 * Summarizes JIRA issues using the Claude API.
 * Input is truncated to 30 issues (oldest dropped first) before sending.
 * @param {object[]} issues - Array of JIRA issue objects from fetchJira()
 * @returns {Promise<{ actionRequired: object[], updates: object[] }>}
 */
export async function summarizeJira(issues) {
  if (!issues || issues.length === 0) return { actionRequired: [], updates: [] }

  // Truncate to 30 issues, dropping oldest-updated first
  const input = [...issues]
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
    .slice(0, 30)

  try {
    const text = await callClaude(PROMPT_JIRA, JSON.stringify(input))
    return JSON.parse(text)
  } catch (err) {
    console.error('[ai] summarizeJira failed:', err.message)
    if (err.message && !err.message.includes('JSON')) {
      // API error — return empty default
    } else {
      // JSON parse error — log raw response excerpt
      console.warn('[ai] summarizeJira raw response (first 200 chars):', String(err.message).slice(0, 200))
    }
    return { actionRequired: [], updates: [] }
  }
}

// ---------------------------------------------------------------------------
// Confluence
// ---------------------------------------------------------------------------

/**
 * Summarizes Confluence pages using the Claude API.
 * Input is truncated to 20 pages before sending.
 * @param {object[]} pages - Array of Confluence page objects from fetchConfluence()
 * @returns {Promise<object[]>}
 */
export async function summarizeConfluence(pages) {
  if (!pages || pages.length === 0) return []

  // Truncate to 20 pages, dropping oldest-modified first
  const input = [...pages]
    .sort((a, b) => new Date(b.lastModifiedAt) - new Date(a.lastModifiedAt))
    .slice(0, 20)

  try {
    const text = await callClaude(PROMPT_CONFLUENCE, JSON.stringify(input))
    return JSON.parse(text)
  } catch (err) {
    console.error('[ai] summarizeConfluence failed:', err.message)
    return []
  }
}

// ---------------------------------------------------------------------------
// GitHub
// ---------------------------------------------------------------------------

const PROMPT_GITHUB = `You are summarizing GitHub notification activity for a morning briefing.

You will receive a JSON array of GitHub notifications (PRs, issues, CI failures, mentions). For each notification, write one concise line describing what happened or what action is needed.

Set "needsAction": true for items that require immediate attention:
- review_requested: a PR review is waiting on you
- assign: you were assigned to an issue
- ci_activity with failures: CI is broken on your PR
- mention or team_mention: someone is asking for your input

Set "needsAction": false for informational items (your PR has new comments, a PR you're watching was updated, etc.).

Keep summaries short and action-oriented. Examples:
- "Review requested — adds OAuth2 support to auth flow"
- "Your PR has new comments from alice"
- "CI failing: build and test steps failed"
- "Assigned to bug: login fails on Safari"

Return JSON only. No markdown, no explanation, no preamble.

Output shape:
[
  {
    "id": "12345678",
    "repo": "myorg/my-repo",
    "title": "feat: add OAuth2 support",
    "url": "https://...",
    "summary": "Review requested — adds OAuth2 support to auth flow",
    "needsAction": true
  }
]`

/**
 * Summarizes GitHub notifications using the Claude API.
 * Input is truncated to 30 notifications before sending.
 * @param {object[]} notifications - Array of enriched notification objects from fetchGithub*()
 * @param {string} label - Instance label for logging (e.g. 'github.com', 'Corporate GitHub')
 * @returns {Promise<object[]>}
 */
export async function summarizeGithub(notifications, label) {
  if (!notifications || notifications.length === 0) return []

  const input = notifications.slice(0, 30)

  try {
    const text = await callClaude(PROMPT_GITHUB, JSON.stringify(input))
    return JSON.parse(text)
  } catch (err) {
    console.error(`[ai] summarizeGithub (${label}) failed:`, err.message)
    return []
  }
}

// ---------------------------------------------------------------------------
// Slack
// ---------------------------------------------------------------------------

const PROMPT_SLACK_MENTIONS = `You are summarizing Slack mentions for a morning briefing.

You will receive a JSON array of messages where the user was mentioned. For each mention, write one concise line describing what they were asked or notified about. Note if a reply seems expected.

Return JSON only. No markdown, no explanation, no preamble.

Output shape:
[
  {
    "channelName": "eng-general",
    "user": "Alice Chen",
    "summary": "Asked you to review PR #482 before end of day",
    "needsReply": true,
    "permalink": "https://..."
  }
]`

const PROMPT_SLACK_DMS = `You are summarizing Slack direct messages for a morning briefing.

You will receive a JSON array of DM threads with unread messages. For each thread, write 1-2 sentences summarizing what was said. Flag if a reply from the user seems expected.

Return JSON only. No markdown, no explanation, no preamble.

Output shape:
[
  {
    "withUser": "Bob Smith",
    "summary": "Wants to sync tomorrow about the Q2 roadmap.",
    "replyExpected": true
  }
]`

const PROMPT_SLACK_SECTION = `You are helping someone decide where to focus their attention today based on Slack channel activity.

You will receive an array of channels with recent messages from others (the user's own messages are already excluded). For each channel, identify discussions where the user should consider engaging:
- Open questions or debates where their expertise or opinion would be valuable
- Architecture or technical decisions being made without a clear conclusion
- Customer feedback or incidents being discussed
- Decisions in progress that affect the user's work
- Announcements they should be aware of

Skip: trivial chatter, fully resolved discussions, status updates requiring no action, bot messages unless incident/alert/error.

For each relevant channel, write up to 5 concise bullets framed as "what's happening and why it might need you." Omit channels where there's nothing worth the user's attention.

Return JSON only. No markdown, no explanation, no preamble.

Output shape:
[
  {
    "channel": "eng-general",
    "bullets": [
      "Open debate on moving to Postgres 16 — no decision yet, Alice asked for input",
      "Bob raised a concern about the auth token refresh edge case in the new flow"
    ]
  }
]

Return [] if nothing warrants the user's attention.`

const PROMPT_SLACK_THREADS = `You are summarizing thread updates for a morning briefing.

You will receive an array of Slack threads where the user previously replied. Each thread shows the new replies from others that appeared after the user's last reply. Determine whether the user should follow up.

For each thread, write one concise line describing what happened and whether a response seems expected.

Return JSON only. No markdown, no explanation, no preamble.

Output shape:
[
  {
    "channelName": "eng-backend",
    "parentText": "Should we use optimistic locking here?",
    "summary": "Alice and Bob pushed back on the approach — waiting for your thoughts",
    "needsReply": true
  }
]`

/**
 * Summarizes Slack mentions using the Claude API.
 * @param {object[]} mentions - From fetchSlack().data.mentions
 * @returns {Promise<object[]>}
 */
export async function summarizeSlackMentions(mentions) {
  if (!mentions || mentions.length === 0) return []

  const input = mentions.slice(0, 20)

  try {
    const text = await callClaude(PROMPT_SLACK_MENTIONS, JSON.stringify(input))
    return JSON.parse(text)
  } catch (err) {
    console.error('[ai] summarizeSlackMentions failed:', err.message)
    return []
  }
}

/**
 * Summarizes Slack direct messages using the Claude API.
 * @param {object[]} directMessages - From fetchSlack().data.directMessages
 * @returns {Promise<object[]>}
 */
export async function summarizeSlackDMs(directMessages) {
  if (!directMessages || directMessages.length === 0) return []

  const input = directMessages.slice(0, 10)

  try {
    const text = await callClaude(PROMPT_SLACK_DMS, JSON.stringify(input))
    return JSON.parse(text)
  } catch (err) {
    console.error('[ai] summarizeSlackDMs failed:', err.message)
    return []
  }
}

/**
 * Summarizes one Slack section's channel activity using the Claude API.
 * Identifies discussions where the user should consider engaging.
 * @param {string} sectionName - Section label (e.g. 'Engineering')
 * @param {object[]} channels - From fetchSlack().data.sections[sectionName].channels
 * @returns {Promise<object[]>} - Array of { channel, bullets }
 */
export async function summarizeSlackSection(sectionName, channels) {
  const channelsWithMessages = channels.filter(ch => ch.messages.length > 0)
  if (channelsWithMessages.length === 0) return []

  // Trim to 5 messages per channel before sending to Claude
  const input = channelsWithMessages.map(ch => ({
    name: ch.name,
    messages: ch.messages.slice(0, 5),
    threadReplies: ch.threadReplies.slice(0, 10),
  }))

  try {
    const text = await callClaude(PROMPT_SLACK_SECTION, JSON.stringify(input))
    return JSON.parse(text)
  } catch (err) {
    console.error(`[ai] summarizeSlackSection (${sectionName}) failed:`, err.message)
    return []
  }
}

/**
 * Summarizes Slack thread updates using the Claude API.
 * These are threads the user participated in that have new replies from others.
 * @param {object[]} threadUpdates - From fetchSlack().data.threadUpdates
 * @returns {Promise<object[]>}
 */
export async function summarizeSlackThreads(threadUpdates) {
  if (!threadUpdates || threadUpdates.length === 0) return []

  const input = threadUpdates.slice(0, 15)

  try {
    const text = await callClaude(PROMPT_SLACK_THREADS, JSON.stringify(input))
    return JSON.parse(text)
  } catch (err) {
    console.error('[ai] summarizeSlackThreads failed:', err.message)
    return []
  }
}

// ---------------------------------------------------------------------------
// TODO: Add summarizeEmails() — Phase 3
// TODO: Add summarizeTeamsActivity(), summarizeMeetings() — Phase 7
// TODO: Add synthesizeActionItems() — Phase 8
// ---------------------------------------------------------------------------
