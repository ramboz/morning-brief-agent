import 'dotenv/config'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { debug } from '../utils/flags.js'

const execFileAsync = promisify(execFile)

// ---------------------------------------------------------------------------
// AI Backend configuration
// AI_BACKEND=claude-cli  — uses Claude Code CLI (claude -p), no API key needed
// AI_BACKEND=openai      — uses OpenAI-compatible API (ChatGPT Enterprise, etc.)
// ---------------------------------------------------------------------------

const AI_BACKEND = process.env.AI_BACKEND ?? 'claude-cli'

if (!['claude-cli', 'openai'].includes(AI_BACKEND)) {
  console.error(`[ai] Unknown AI_BACKEND "${AI_BACKEND}" — expected "claude-cli" or "openai"`)
}
if (AI_BACKEND === 'openai' && !process.env.OPENAI_API_KEY) {
  console.error('[ai] OPENAI_API_KEY not set — summarization will fail')
}

// ---------------------------------------------------------------------------
// Prompt constants
// ---------------------------------------------------------------------------

const PROMPT_JIRA = `You are helping an engineer decide where to focus their attention today based on JIRA activity.

You will receive a JSON array of JIRA issues the user is involved with. Separate them into two groups:
- "actionRequired": tickets where the user needs to take action today (blocked on them, review requested, direct question, needs their decision or approval)
- "updates": tickets with open discussions, unresolved questions, or decisions in progress where the user's input could add value — even if not explicitly asked

For each ticket, write one concise line framed as "why this might need you today" rather than just what happened.
Skip issues where: nothing new happened, only metadata changed, or the user already has the last word and no one has responded.

Return JSON only. No markdown, no explanation, no preamble.

Output shape:
{
  "actionRequired": [
    { "key": "ENG-482", "summary": "Alice is blocked on token refresh edge case — needs your review" }
  ],
  "updates": [
    { "key": "ENG-410", "summary": "Debate on caching strategy — no decision yet, your input on trade-offs would help" }
  ]
}`

const PROMPT_CONFLUENCE = `You are helping an engineer decide which Confluence pages deserve their attention today.

You will receive a JSON array of recently modified Confluence pages. For each page, assess whether the user should review, comment, or respond — not just that something changed.

Include a page if:
- The user was explicitly mentioned ("reason": "mentioned")
- The page covers an area the user likely owns or is responsible for, and a significant decision or direction was added
- There's an open question, RFC, or proposal that hasn't been resolved
- The change is substantial enough that being unaware of it could affect the user's work

Skip pages where:
- The user made the last edit and no one has replied or changed it since
- The edit is trivial (formatting, typos, version bump, minor wording)
- The content is purely informational with no action or engagement opportunity

Write one concise line framed as "why this might need your attention" rather than just what changed.

Return JSON only. No markdown, no explanation, no preamble.

Output shape:
[
  {
    "title": "Q1 Engineering Roadmap",
    "space": "ENG",
    "url": "https://...",
    "summary": "Alice added a mobile-first section to Q2 priorities — may affect your team's roadmap",
    "needsAttention": false
  }
]

Set "needsAttention": true if the user was mentioned or the change directly affects their work or decisions.`

// ---------------------------------------------------------------------------
// Shared call wrapper
// ---------------------------------------------------------------------------

/**
 * Calls the configured AI backend with a system prompt and user content.
 * Backend is selected via AI_BACKEND env var ("claude-cli" or "openai").
 * @param {string} prompt - System prompt
 * @param {string} userContent - User message content
 * @param {number} [maxTokens] - Used by the OpenAI backend; ignored by claude-cli
 * @returns {Promise<string>} Raw text response
 */
async function callClaude(prompt, userContent, maxTokens = 1000) {
  if (AI_BACKEND === 'openai') {
    return callOpenAI(prompt, userContent, maxTokens)
  }
  return callClaudeCLI(prompt, userContent)
}

/**
 * Invokes Claude Code CLI in print mode as a subprocess.
 * Requires `claude` to be installed and authenticated in the current shell.
 * @param {string} prompt - System prompt (prepended to user content)
 * @param {string} userContent - Data to summarize
 * @returns {Promise<string>}
 */
async function callClaudeCLI(prompt, userContent) {
  const fullPrompt = `${prompt}\n\n${userContent}`
  debug('[ai]', `callClaudeCLI — prompt ${fullPrompt.length} chars`)
  const t0 = Date.now()
  const { stdout } = await execFileAsync('claude', ['-p', fullPrompt], {
    maxBuffer: 2 * 1024 * 1024, // 2 MB
    timeout: 120_000,           // 2 minute hard timeout
  })
  const response = stdout.trim()
  debug('[ai]', `callClaudeCLI — done in ${Date.now() - t0}ms, response ${response.length} chars`)
  return response
}

/**
 * Calls an OpenAI-compatible chat completions API.
 * Works with api.openai.com and ChatGPT Enterprise endpoints.
 * @param {string} prompt - System prompt
 * @param {string} userContent - User message content
 * @param {number} maxTokens
 * @returns {Promise<string>}
 */
async function callOpenAI(prompt, userContent, maxTokens) {
  const baseUrl = (process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, '')
  const model = process.env.OPENAI_MODEL ?? 'gpt-4o'
  debug('[ai]', `callOpenAI — model=${model}, endpoint=${baseUrl}, prompt ${(prompt + userContent).length} chars`)
  const t0 = Date.now()

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: userContent },
      ],
    }),
  })

  if (!response.ok) {
    throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`)
  }

  const data = await response.json()
  const text = data.choices[0].message.content
  debug('[ai]', `callOpenAI — done in ${Date.now() - t0}ms, response ${text.length} chars`)
  return text
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

const PROMPT_GITHUB = `You are helping an engineer decide where to focus their attention today based on GitHub notifications.

You will receive a JSON array of GitHub notifications (PRs, issues, CI failures, mentions). For each, assess whether the user should act or engage — not just that something happened.

Set "needsAction": true for items requiring immediate attention:
- review_requested: a PR review is waiting on you
- assign: you were assigned to an issue
- ci_activity with failures: CI is broken on your PR
- mention or team_mention: someone is directly asking for your input

Set "needsAction": false but still include if there's an open discussion where the user's input would be valuable:
- A PR they authored has unresolved comments or questions that need a response
- A PR or issue they're watching has an unresolved debate or design question
- An issue they're assigned to or watching has new, unresolved information

Skip notifications where nothing needs engagement:
- A PR they're watching was merged with no open questions
- A resolved or closed item with no follow-up needed
- Bot comments or automated status updates with no human discussion

Keep summaries concise and framed around why the user should care today. Examples:
- "Review requested — adds OAuth2 support to auth flow"
- "Alice left unresolved questions on your PR about error handling"
- "CI failing on your feature branch: build step failing"
- "Open debate on API versioning approach — no decision yet"

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
