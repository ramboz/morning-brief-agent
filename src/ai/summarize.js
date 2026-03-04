import 'dotenv/config'
import { spawn } from 'child_process'
import { debug, aiModel } from '../utils/flags.js'

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
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extracts and parses JSON from an AI response.
 * Handles markdown code fences and trailing explanation text that some models append.
 * Finds the outermost [ ] or { } block and parses only that portion.
 * @param {string} text - Raw AI response
 * @returns {any} Parsed JSON
 */
function parseJSONResponse(text) {
  // Strip markdown code fences first
  const stripped = text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim()

  // Find the outermost JSON structure (array or object)
  const arrayStart = stripped.indexOf('[')
  const objectStart = stripped.indexOf('{')
  let start = -1
  let endChar

  if (arrayStart === -1 && objectStart === -1) return JSON.parse(stripped)

  if (arrayStart !== -1 && (objectStart === -1 || arrayStart < objectStart)) {
    start = arrayStart
    endChar = ']'
  } else {
    start = objectStart
    endChar = '}'
  }

  const end = stripped.lastIndexOf(endChar)
  if (end === -1) return JSON.parse(stripped)

  return JSON.parse(stripped.slice(start, end + 1))
}

// ---------------------------------------------------------------------------
// JSON schemas — enforce structured output via --json-schema (claude-cli)
// or response_format (openai)
// ---------------------------------------------------------------------------

const SCHEMA_JIRA = {
  type: 'object',
  properties: {
    actionRequired: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          summary: { type: 'string' },
        },
        required: ['key', 'summary'],
        additionalProperties: false,
      },
    },
    updates: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          summary: { type: 'string' },
        },
        required: ['key', 'summary'],
        additionalProperties: false,
      },
    },
  },
  required: ['actionRequired', 'updates'],
  additionalProperties: false,
}

const SCHEMA_CONFLUENCE = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      space: { type: 'string' },
      url: { type: 'string' },
      summary: { type: 'string' },
      needsAttention: { type: 'boolean' },
    },
    required: ['title', 'space', 'url', 'summary', 'needsAttention'],
    additionalProperties: false,
  },
}

const SCHEMA_GITHUB = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      repo: { type: 'string' },
      title: { type: 'string' },
      url: { type: 'string' },
      summary: { type: 'string' },
      needsAction: { type: 'boolean' },
    },
    required: ['id', 'repo', 'title', 'url', 'summary', 'needsAction'],
    additionalProperties: false,
  },
}

const SCHEMA_SLACK_MENTIONS = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      channelName: { type: 'string' },
      user: { type: 'string' },
      summary: { type: 'string' },
      needsReply: { type: 'boolean' },
      permalink: { type: 'string' },
    },
    required: ['channelName', 'user', 'summary', 'needsReply', 'permalink'],
    additionalProperties: false,
  },
}

const SCHEMA_SLACK_DMS = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      withUser: { type: 'string' },
      summary: { type: 'string' },
      replyExpected: { type: 'boolean' },
    },
    required: ['withUser', 'summary', 'replyExpected'],
    additionalProperties: false,
  },
}

const SCHEMA_SLACK_CHANNELS = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      channel: { type: 'string' },
      channelId: { type: 'string' },
      bullets: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            text: { type: 'string' },
            ts: { type: 'string' },
          },
          required: ['text', 'ts'],
          additionalProperties: false,
        },
      },
    },
    required: ['channel', 'channelId', 'bullets'],
    additionalProperties: false,
  },
}

const SCHEMA_SLACK_THREADS = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      channelName: { type: 'string' },
      parentText: { type: 'string' },
      summary: { type: 'string' },
      needsReply: { type: 'boolean' },
    },
    required: ['channelName', 'parentText', 'summary', 'needsReply'],
    additionalProperties: false,
  },
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
 * @param {{ maxTokens?: number, schema?: object }} [opts]
 * @returns {Promise<string>} Raw text response
 */
async function callClaude(prompt, userContent, opts = {}) {
  const { maxTokens = 1000, schema } = opts
  if (AI_BACKEND === 'openai') {
    return callOpenAI(prompt, userContent, maxTokens, schema)
  }
  return callClaudeCLI(prompt, userContent, schema)
}

/**
 * Invokes Claude Code CLI in print mode as a subprocess.
 * When a JSON schema is provided, passes --json-schema to enforce structured output.
 * @param {string} prompt - System prompt (prepended to user content)
 * @param {string} userContent - Data to summarize
 * @param {object} [schema] - JSON Schema for structured output validation
 * @returns {Promise<string>}
 */
function callClaudeCLI(prompt, userContent) {
  const fullPrompt = `${prompt}\n\n${userContent}`
  const t0 = Date.now()

  const args = ['-p', fullPrompt]
  if (aiModel) args.push('--model', aiModel)

  debug('[ai]', `callClaudeCLI — model=${aiModel ?? 'default'}, prompt ${fullPrompt.length} chars`)

  return new Promise((resolve, reject) => {
    const child = spawn('claude', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    child.stdout.on('data', d => { stdout += d })
    child.stderr.on('data', d => { stderr += d })

    const timeoutMs = parseInt(process.env.AI_TIMEOUT_MS ?? '300000')
    const timer = setTimeout(() => {
      const elapsed = Math.round((Date.now() - t0) / 1000)
      console.error(`[ai] claude CLI timed out after ${elapsed}s — killing pid ${child.pid}`)
      if (stderr.trim()) console.error(`[ai] stderr before timeout: ${stderr.slice(0, 500)}`)
      if (stdout.trim()) debug('[ai]', `stdout before timeout (${stdout.length} chars): ${stdout.slice(0, 200)}`)
      child.kill()
      reject(new Error(`claude CLI timed out after ${elapsed}s`))
    }, timeoutMs)

    child.on('error', err => {
      clearTimeout(timer)
      reject(err)
    })

    child.on('close', code => {
      clearTimeout(timer)
      if (stderr.trim()) {
        debug('[ai]', `stderr: ${stderr.trim().slice(0, 500)}`)
      }
      if (code !== 0) {
        reject(new Error(`claude CLI exited ${code}: ${stderr.slice(0, 300)}`))
        return
      }
      const response = stdout.trim()
      debug('[ai]', `callClaudeCLI — done in ${Date.now() - t0}ms, response ${response.length} chars`)
      if (!response) {
        reject(new Error('claude CLI returned empty response'))
        return
      }
      resolve(response)
    })
  })
}

/**
 * Calls an OpenAI-compatible chat completions API.
 * When a schema is provided, uses response_format for structured output.
 * @param {string} prompt - System prompt
 * @param {string} userContent - User message content
 * @param {number} maxTokens
 * @param {object} [schema] - JSON Schema for structured output
 * @returns {Promise<string>}
 */
async function callOpenAI(prompt, userContent, maxTokens, schema) {
  const baseUrl = (process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, '')
  const model = process.env.OPENAI_MODEL ?? 'gpt-4o'
  debug('[ai]', `callOpenAI — model=${model}, endpoint=${baseUrl}, prompt ${(prompt + userContent).length} chars`)
  const t0 = Date.now()

  const body = {
    model,
    max_tokens: maxTokens,
    messages: [
      { role: 'system', content: prompt },
      { role: 'user', content: userContent },
    ],
  }
  if (schema) {
    body.response_format = {
      type: 'json_schema',
      json_schema: { name: 'response', strict: true, schema },
    }
  }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
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
    const text = await callClaude(PROMPT_JIRA, JSON.stringify(input), { schema: SCHEMA_JIRA })
    return parseJSONResponse(text)
  } catch (err) {
    console.error('[ai] summarizeJira failed:', err.message)
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
    const text = await callClaude(PROMPT_CONFLUENCE, JSON.stringify(input), { schema: SCHEMA_CONFLUENCE })
    return parseJSONResponse(text)
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
    const text = await callClaude(PROMPT_GITHUB, JSON.stringify(input), { schema: SCHEMA_GITHUB })
    return parseJSONResponse(text)
  } catch (err) {
    console.error(`[ai] summarizeGithub (${label}) failed:`, err.message)
    return []
  }
}

// ---------------------------------------------------------------------------
// Slack
// ---------------------------------------------------------------------------

const PROMPT_SLACK_MENTIONS = `You are summarizing Slack mentions for a morning briefing.

You will receive a JSON array of messages where the user was mentioned. Each item has the original mention text, and optionally a "threadContext" array showing the most recent replies in the thread that followed.

IMPORTANT: Only return items where the user genuinely still needs to act. If a thread is resolved, omit it entirely — do not return it with needsReply: false.

For each item you include, write one concise line describing the CURRENT open situation — not the original message. If threadContext shows a follow-up question from someone else, describe that follow-up (and name who is asking) rather than the original mention. The summary should reflect what is unresolved RIGHT NOW.

Include an item (needsReply: true) only if:
- The user was asked a question and there's no clear answer in threadContext
- A follow-up question was raised (by anyone) that remains open
- They were tagged with a specific outstanding ask that hasn't been addressed

OMIT an item entirely if any of these are true:
- threadContext shows a direct factual answer, explanation, or resolution — even if you can't verify its correctness
- The original asker acknowledged the answer ("Got it", "Thanks", "Makes sense", "I'll try that", "Will do")
- The requester said they'll handle it themselves ("I'll reach out to X", "I'll start integrating")
- The mention was purely informational — no direct ask was made
- threadContext shows multiple replies from others but the original asker did NOT follow up with a new question (conversation concluded naturally)

Key principle: when threadContext shows a clear, direct answer, treat the thread as resolved. Err toward omitting rather than creating false urgency.

Return JSON only. No markdown, no explanation, no preamble. Return [] if nothing requires attention.

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

const PROMPT_SLACK_CHANNELS = `You are helping someone decide where to focus their attention today based on Slack channel activity.

You will receive an array of channels with recent messages from others (the user's own messages are already excluded). Each channel has a "name", "channelId", "messages" (with ts, user, text), and "threadReplies". For each channel, identify discussions where the user should consider engaging:
- Open questions or debates where their expertise or opinion would be valuable
- Architecture or technical decisions being made without a clear conclusion
- Customer feedback or incidents being discussed
- Decisions in progress that affect the user's work
- Announcements they should be aware of

Skip: trivial chatter, fully resolved discussions, status updates requiring no action, bot messages unless incident/alert/error.

For each relevant channel, write up to 5 concise bullets framed as "what's happening and why it might need you." Omit channels where there's nothing worth the user's attention.

IMPORTANT: Each channel must appear at most ONCE in the output. Do not split a channel into multiple entries.

For each bullet, include the "ts" of the single most relevant message or thread reply from the input. If no single message is clearly associated, use the ts of the most recent relevant message.

Pass "channelId" through unchanged from the input.

Return JSON only. No markdown, no explanation, no preamble.

Output shape:
[
  {
    "channel": "eng-general",
    "channelId": "C012AB3CD",
    "bullets": [
      { "text": "Open debate on moving to Postgres 16 — no decision yet, Alice asked for input", "ts": "1234567890.123456" },
      { "text": "Bob raised a concern about the auth token refresh edge case in the new flow", "ts": "1234567891.000000" }
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
    const text = await callClaude(PROMPT_SLACK_MENTIONS, JSON.stringify(input), { schema: SCHEMA_SLACK_MENTIONS })
    return parseJSONResponse(text)
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
    const text = await callClaude(PROMPT_SLACK_DMS, JSON.stringify(input), { schema: SCHEMA_SLACK_DMS })
    return parseJSONResponse(text)
  } catch (err) {
    console.error('[ai] summarizeSlackDMs failed:', err.message)
    return []
  }
}

/**
 * Summarizes priority channel activity using the Claude API.
 * Identifies discussions where the user should consider engaging.
 * @param {object[]} channels - From fetchSlack().data.channels
 * @returns {Promise<object[]>} - Array of { channel, bullets }
 */
export async function summarizeSlackChannels(channels) {
  const channelsWithMessages = channels.filter(ch => ch.messages.length > 0)
  if (channelsWithMessages.length === 0) return []

  const input = channelsWithMessages.map(ch => ({
    name: ch.name,
    channelId: ch.id,
    messages: ch.messages.slice(0, 5),
    threadReplies: ch.threadReplies.slice(0, 10),
  }))

  try {
    const text = await callClaude(PROMPT_SLACK_CHANNELS, JSON.stringify(input), { schema: SCHEMA_SLACK_CHANNELS })
    const raw = parseJSONResponse(text)

    // Merge any duplicate channel entries the AI may have returned (case-insensitive, strip leading #)
    const seen = new Map()
    const merged = []
    for (const entry of raw) {
      const key = entry.channel.replace(/^#/, '').toLowerCase()
      if (seen.has(key)) {
        seen.get(key).bullets.push(...(entry.bullets ?? []))
      } else {
        seen.set(key, entry)
        merged.push(entry)
      }
    }
    return merged
  } catch (err) {
    console.error('[ai] summarizeSlackChannels failed:', err.message)
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
    const text = await callClaude(PROMPT_SLACK_THREADS, JSON.stringify(input), { schema: SCHEMA_SLACK_THREADS })
    return parseJSONResponse(text)
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
