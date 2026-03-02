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
// TODO: Add summarizeEmails() — Phase 3
// TODO: Add summarizeSlackMentions(), summarizeSlackDMs(), summarizeSlackSection() — Phase 4
// TODO: Add summarizeGithub() — Phase 6
// TODO: Add summarizeTeamsActivity(), summarizeMeetings() — Phase 7
// TODO: Add synthesizeActionItems() — Phase 8
// ---------------------------------------------------------------------------
