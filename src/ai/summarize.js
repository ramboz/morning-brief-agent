import 'dotenv/config'
import { spawn } from 'child_process'
import { debug, aiModel } from '../utils/flags.js'
import { withContext } from '../utils/context.js'

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
      dmChannelId: { type: 'string' },
      summary: { type: 'string' },
      replyExpected: { type: 'boolean' },
    },
    required: ['withUser', 'dmChannelId', 'summary', 'replyExpected'],
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
      channelId: { type: 'string' },
      threadTs: { type: 'string' },
      parentText: { type: 'string' },
      summary: { type: 'string' },
      needsReply: { type: 'boolean' },
    },
    required: ['channelName', 'channelId', 'threadTs', 'parentText', 'summary', 'needsReply'],
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

You will receive a JSON array of recently modified Confluence pages. Your job is aggressive filtering — most pages should be OMITTED. Only return pages that would change what the user does today.

Include a page ONLY if ALL of these are true:
- Someone OTHER than the user made a meaningful edit (check "lastModifiedBy" against the user's name from the context above)
- The change involves a decision, open question, RFC, or direction that affects the user's responsibilities
- The user was explicitly mentioned ("reason": "mentioned") OR the page is in their active focus area AND has a substantive change

NEVER include — omit these entirely, do not return them in the output:
- Pages where the user is the last editor (lastModifiedBy matches the user) — they know what they wrote
- Pages the user just created (low version number, lastModifiedBy is the user) — no one has responded yet
- Pages on topics marked as deprioritized in the user context — do NOT include with a note like "deprioritized", just omit
- Team status updates, weekly reports, sprint reports, standup notes (e.g. "Week 11'26", "Sprint Review", "Weekly Status")
- Operational runbooks, environment configs, deployment guides — unless there's an active incident referencing them
- Tracking pages, catalogs, or dashboards with no open question or decision
- Milestone or roadmap pages where nothing changed that affects the user's work
- Demo tracking, brainstorm ideation, or early-stage pages with no decision point
- Pages that are purely informational with no action or engagement opportunity

Before returning each page, ask: "Would ignoring this page cause the user to miss something they need to act on today?" If no, omit it.

Write one concise line framed as "why this needs your attention" rather than just what changed.

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
    const text = await callClaude(await withContext(PROMPT_CONFLUENCE), JSON.stringify(input), { schema: SCHEMA_CONFLUENCE })
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

Keep summaries concise and framed around why the user should care today.
Always mention the author (from the "author" field) — it is important for the user to know who to engage with.
Always refer to GitHub users with the @ prefix (e.g. @zehnder, not just zehnder). The "author" field already contains the formatted name.

Examples:
- "@alice requested your review — adds OAuth2 support to auth flow"
- "@bob left unresolved questions on your PR about error handling"
- "CI failing on @zehnder's PR — build step failing"
- "Open debate on API versioning approach — @carol and @dave disagree, no decision yet"

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

Always refer to people by their Slack handle with the @ prefix (e.g. @rpapani, not rpapani).

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

You will receive a JSON array of DM conversations with recent messages. For each conversation, write 1-2 sentences summarizing what was said. Flag if a reply from the user seems expected.

Include a DM conversation only if there's something the user should know or respond to. OMIT conversations where:
- The only messages are simple acknowledgments ("thanks", "got it", "sounds good")
- The conversation is fully resolved with no open question or pending action
- The content is trivial or purely social with no work relevance

Pass through "dmId" from the input unchanged as "dmChannelId" for each item.

Return JSON only. No markdown, no explanation, no preamble. Return [] if nothing warrants attention.

Output shape:
[
  {
    "withUser": "Bob Smith",
    "dmChannelId": "D012AB3CD",
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

Skip these entirely — they add noise, not signal:
- Simple acknowledgments and reactions expressed as text: "thanks", "got it", "will do", "sounds good", "+1", emoji-only messages
- Trivial chatter: greetings, social messages, lunch plans, "happy Friday" posts
- Fully resolved discussions where a clear conclusion was reached and no open question remains
- Status updates requiring no action or response (e.g. "deployed to staging", "tests passing")
- Bot messages unless they contain incident, alert, error, outage, or failure keywords
- Thread replies that are only acknowledgments of a resolved question

For each relevant channel, write up to 5 concise bullets framed as "what's happening and why it might need you." Omit channels where there's nothing worth the user's attention.
When mentioning people by name or handle, always use the @ prefix (e.g. @zehnder, not zehnder).

IMPORTANT: Each channel must appear at most ONCE in the output. Do not split a channel into multiple entries.

For each bullet, include the "ts" of the single most relevant message or thread reply from the input. If no single message is clearly associated, use the ts of the most recent relevant message.

If a message text contains a GitHub PR or issue URL (e.g. https://github.com/org/repo/pull/123 or https://github.com/org/repo/issues/456), include it in the bullet "text" as a markdown link: [repo #number](url). Example: "@zehnder requesting review on [spacecat-api-service #1892](https://github.com/adobe/spacecat-api-service/pull/1892)". This preserves the URL for deep linking.

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

For each thread you include, write one concise line describing what happened and whether a response seems expected.

Include a thread (needsReply: true or false) if:
- Someone asked a follow-up question the user hasn't answered
- There's a disagreement or pushback on the user's position
- New information or a decision was shared that the user should know about
- Someone is blocked or waiting on the user

OMIT a thread entirely if the only new replies are:
- Simple acknowledgments ("thanks", "got it", "will do", "sounds good", "👍", "+1")
- Emoji-only reactions or single-word confirmations
- Bot messages with no actionable content
- Redundant status updates with nothing new for the user

Pass through "channelId" and "threadTs" unchanged from the input for each item.

Return JSON only. No markdown, no explanation, no preamble. Return [] if nothing warrants attention.

Output shape:
[
  {
    "channelName": "eng-backend",
    "channelId": "C012AB3CD",
    "threadTs": "1234567890.123456",
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
// Cross-source synthesis
// ---------------------------------------------------------------------------

const SCHEMA_ACTION_ITEMS = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      source:    { type: 'string' },
      text:      { type: 'string' },
      url:       { type: 'string' },
      permalink: { type: 'string' },
      channelId: { type: 'string' },
      ts:        { type: 'string' },
    },
    required: ['source', 'text', 'url', 'permalink', 'channelId', 'ts'],
    additionalProperties: false,
  },
}

const SCHEMA_PROJECT_CLUSTERS = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      signals: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            source:  { type: 'string' },
            summary: { type: 'string' },
            url:     { type: 'string' },
          },
          required: ['source', 'summary', 'url'],
          additionalProperties: false,
        },
      },
    },
    required: ['name', 'signals'],
    additionalProperties: false,
  },
}

const PROMPT_ACTION_ITEMS = `You are synthesizing a morning briefing for an engineer. You will receive pre-summarized data from multiple work tools: JIRA, Wiki (Confluence), GitHub (public and corporate), and Slack (mentions, thread updates, DMs).

Your job: produce a single prioritized list of up to 10 action items the engineer must attend to today.

Rules:
- Include only items that require action: a review is needed, a question needs answering, someone is blocked on the user, a decision is needed
- Omit informational updates, FYI items, resolved items, or anything that does not require the user to do something today
- Deduplicate: if the same underlying task appears in multiple sources (e.g. a JIRA ticket AND a Slack mention about it), merge into one item — use the most informative source tag and the most specific URL
- Do NOT merge multiple PRs or issues into a single action item — emit one item per PR/issue
- Prioritize: blocking or time-sensitive items first
- Write each item as a plain-text one-liner — concise, specific, actionable. State what needs to happen and why it matters today.
- Source tags: [JIRA], [GitHub], [GitHub Corp], [Slack], [Wiki]
- For GitHub/GitHub Corp items, format "text" as: repo #number — description (e.g. "spacecat-api-service #1892 — review requested: adds retry logic")
- For GitHub users, always use @ prefix in descriptions (e.g. @zehnder, not zehnder)
- Always include "url" — use the item's URL if available, empty string otherwise
- Always include "permalink" — use the Slack permalink if it's a Slack item, empty string otherwise

Input structure:
{
  "jira": { "actionRequired": [...], "updates": [...] },
  "wiki": [...],
  "github": [...],
  "githubCorp": [...],
  "slackMentions": [...],
  "slackThreads": [...],
  "slackDMs": [...],
  "slackChannels": [{ "channel": "...", "channelId": "...", "url": "https://...", "bullets": [{ "text": "...", "ts": "..." }] }]
}

Selection rules per source:
- jira.actionRequired: include all
- jira.updates: include only if a direct question or decision is open
- wiki: include only if needsAttention: true
- github / githubCorp: include only if needsAction: true
- slackMentions: include only if needsReply: true — set "permalink" to the item's permalink value, "channelId" and "ts" to empty string
- slackThreads: include only if needsReply: true — set "channelId" to the item's channelId, "ts" to the item's threadTs, "permalink" to empty string
- slackDMs: include only if replyExpected: true — set "channelId" to the item's dmChannelId, "ts" to empty string, "permalink" to empty string
- slackChannels: include a bullet only if it describes an explicit ask directed at the user, someone is blocked waiting for them, a review or decision is needed, or a time-sensitive action is required; skip informational updates or discussions the user can observe passively — set "channelId" to the channel's channelId, "ts" to the bullet's ts, "permalink" to empty string

For all non-Slack items, set "channelId" and "ts" to empty string.
For Slack items from slackChannels: if the bullet text contains a markdown link to a GitHub PR or issue (e.g. [repo #number](https://...)), extract and use that as "url". Otherwise, use the channel's "url" field from the input as "url".
For Slack items from slackMentions/slackThreads/slackDMs: set "url" to empty string (permalinks and channelId handle the linking).

Return JSON only. No markdown, no explanation, no preamble.

Output shape:
[
  { "source": "JIRA",   "text": "ENG-482 — Alice is blocked on token refresh, needs your review", "url": "https://jira.../browse/ENG-482", "permalink": "", "channelId": "", "ts": "" },
  { "source": "GitHub", "text": "my-repo #91 — review requested, adds OAuth2 support",            "url": "https://github.com/...",           "permalink": "", "channelId": "", "ts": "" },
  { "source": "Slack",  "text": "#eng-backend — caching approach debate, your input was asked for", "url": "",                                "permalink": "https://...", "channelId": "", "ts": "" },
  { "source": "Slack",  "text": "#eng-general — Alice asked for your decision on the API design",   "url": "",                                "permalink": "", "channelId": "C012AB3CD", "ts": "1234567890.123456" }
]`

const PROMPT_PROJECT_CLUSTERS = `You are synthesizing a morning briefing for an engineer. You will receive pre-summarized data from multiple work tools: JIRA, Wiki (Confluence), GitHub (public and corporate), and Slack (mentions, thread updates, DMs).

Your job: identify cross-source focus areas — projects, features, or systems generating activity in 2 or more tools today.

Rules:
- Only create a cluster if the same topic appears in 2 or more distinct sources
- Name each cluster after the project, feature, or system it represents (e.g. "Auth Service", "Q2 Roadmap", "API Gateway")
- For each cluster, list one concise signal line per source — what's happening in that source regarding this topic
- Sort clusters by number of signals descending (most cross-source activity first)
- Max 5 clusters — only the most active topics
- Single-source topics are already covered by the per-source sections — omit them here
- Always include "url" — use the item URL if available, empty string otherwise
- Use source tag "Wiki" (not "Confluence") for items from the wiki input array
- Always use @ prefix when referencing people (e.g. @alice, not alice or rpapani)
- If a slackChannels bullet text contains GitHub PR or issue markdown links (e.g. [repo #number](url)), preserve those links inline in the signal "summary".
- For Slack signals sourced from slackChannels: use the channel's "url" field from the input as the signal "url". Each slackChannels entry has a "url" field with the channel archive link — pass it through.
- For Slack signals sourced from slackMentions, slackThreads, or slackDMs: set "url" to empty string.

Input structure:
{
  "jira": { "actionRequired": [...], "updates": [...] },
  "wiki": [...],
  "github": [...],
  "githubCorp": [...],
  "slackMentions": [...],
  "slackThreads": [...],
  "slackDMs": [...],
  "slackChannels": [{ "channel": "...", "channelId": "...", "url": "https://...", "bullets": [{ "text": "...", "ts": "..." }] }]
}

Return JSON only. No markdown, no explanation, no preamble. Return [] if no cross-source clusters exist.

Output shape:
[
  {
    "name": "Auth Service",
    "signals": [
      { "source": "JIRA",   "summary": "ENG-482 blocked — token refresh edge case",         "url": "https://jira.../browse/ENG-482" },
      { "source": "GitHub", "summary": "PR #91 — review requested for OAuth2 changes",      "url": "https://github.com/..." },
      { "source": "Slack",  "summary": "3 mentions in #eng-backend about token refresh failures", "url": "https://myteam.slack.com/archives/C012AB3CD" }
    ]
  }
]`

/**
 * Synthesizes a cross-source prioritized action list from all per-source summaries.
 * Deduplicates items that appear in multiple sources and prioritizes blocking/time-sensitive work.
 * @param {{ jira: object, wiki: object[], github: object[], githubCorp: object[], slackMentions: object[], slackThreads: object[], slackDMs: object[], slackChannels: object[] }} allSummaries
 * @returns {Promise<Array<{ source: string, text: string, url: string, permalink: string }>>}
 */
export async function synthesizeActionItems(allSummaries) {
  const hasData = (
    allSummaries.jira?.actionRequired?.length > 0 ||
    allSummaries.jira?.updates?.length > 0 ||
    allSummaries.wiki?.length > 0 ||
    allSummaries.github?.length > 0 ||
    allSummaries.githubCorp?.length > 0 ||
    allSummaries.slackMentions?.length > 0 ||
    allSummaries.slackThreads?.length > 0 ||
    allSummaries.slackDMs?.length > 0 ||
    allSummaries.slackChannels?.length > 0
  )
  if (!hasData) return []

  try {
    const text = await callClaude(await withContext(PROMPT_ACTION_ITEMS), JSON.stringify(allSummaries), { maxTokens: 1500, schema: SCHEMA_ACTION_ITEMS })
    return parseJSONResponse(text)
  } catch (err) {
    console.error('[ai] synthesizeActionItems failed:', err.message)
    return []
  }
}

/**
 * Identifies cross-source focus areas — projects or topics with signals in 2+ tools today.
 * Only clusters with 2 or more distinct source signals are included.
 * @param {{ jira: object, wiki: object[], github: object[], githubCorp: object[], slackMentions: object[], slackThreads: object[], slackDMs: object[], slackChannels: object[] }} allSummaries
 * @returns {Promise<Array<{ name: string, signals: Array<{ source: string, summary: string, url: string }> }>>}
 */
export async function synthesizeProjectClusters(allSummaries) {
  const hasData = (
    allSummaries.jira?.actionRequired?.length > 0 ||
    allSummaries.jira?.updates?.length > 0 ||
    allSummaries.wiki?.length > 0 ||
    allSummaries.github?.length > 0 ||
    allSummaries.githubCorp?.length > 0 ||
    allSummaries.slackMentions?.length > 0 ||
    allSummaries.slackThreads?.length > 0 ||
    allSummaries.slackDMs?.length > 0 ||
    allSummaries.slackChannels?.length > 0
  )
  if (!hasData) return []

  try {
    const text = await callClaude(await withContext(PROMPT_PROJECT_CLUSTERS), JSON.stringify(allSummaries), { maxTokens: 1000, schema: SCHEMA_PROJECT_CLUSTERS })
    return parseJSONResponse(text)
  } catch (err) {
    console.error('[ai] synthesizeProjectClusters failed:', err.message)
    return []
  }
}

// ---------------------------------------------------------------------------
// TODO: Add summarizeEmails() — Phase 3
// TODO: Add summarizeTeamsActivity(), summarizeMeetings() — Phase 7
// ---------------------------------------------------------------------------
