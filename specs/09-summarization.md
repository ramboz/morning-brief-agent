# Spec 09 — Summarization (Claude API)

## Overview

`src/ai/summarize.js` is the **only** file that calls the Claude API. Every source has its own summarization function. All prompts are stored as named constants at the top of the file, not inline strings. A final synthesis function combines all source summaries into the ⚡ Action Items section.

---

## SDK Setup

```js
import Anthropic from '@anthropic-ai/sdk'

const MODEL = 'claude-sonnet-4-20250514'
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
```

`MODEL` is a single constant used everywhere in the file — changing it in one place updates all calls.

---

## Shared Conventions

### Prompts as named constants

Every prompt lives as a `const` at the top of the file:

```js
const PROMPT_EMAIL = `...`
const PROMPT_SLACK_MENTIONS = `...`
// etc.
```

Never define a prompt inline inside a function call.

### JSON-only output

Every prompt must end with: `Return JSON only. No markdown, no explanation, no preamble.`

If Claude returns invalid JSON, log a warning (include the first 200 chars of the raw response) and return the safe default for that function. Never throw.

### Standard call wrapper

```js
async function callClaude(prompt, userContent, maxTokens = 1000) {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system: prompt,
    messages: [{ role: 'user', content: userContent }],
  })
  return response.content[0].text
}
```

All summarization functions use this wrapper. Errors from it are caught in the caller.

### Error pattern

```js
async function summarizeX(data) {
  try {
    const text = await callClaude(PROMPT_X, JSON.stringify(data))
    return JSON.parse(text)
  } catch (err) {
    console.error('[ai] summarizeX failed:', err.message)
    return /* safe default for this function */
  }
}
```

If the Claude API is unavailable, the section appears as `_Summarization unavailable._` in the daily note rather than crashing the run.

### Input truncation

Truncate inputs before sending to Claude. Each function specifies its limit. Always drop the least important items first (oldest by timestamp, or lowest priority).

---

## Functions

### summarizeEmails(emails)

See `specs/03-outlook.md` for full classification criteria and draft generation rules — that spec is authoritative.

**Input:** array of email objects (see spec 03 for shape)
**Max input:** 50 emails — already enforced by `fetchOutlook()`
**Max tokens:** 1000

**Prompt instructions:**
- Classify each email as: `action_required`, `fyi`, `newsletter`, `marketing`, `automated_alert`, or `junk`
- For `action_required`: 1-2 sentence summary + decide if a draft reply is warranted (see spec 03 draft criteria)
- For `fyi`: 1-sentence summary
- For `newsletter`, `marketing`, `automated_alert`, `junk`: classification only, no summary needed
- Default to `fyi` when uncertain — never classify as auto-archive/delete unless confident
- Draft tone, language, and signature rules are in spec 03

**Output shape:**
```js
{
  actionRequired: [
    { id, subject, from, summary, hasDraft }
  ],
  fyi: [
    { id, subject, from, summary }
  ],
  autoArchived: [
    { id, subject, action: 'archive' | 'delete' }
  ],
  drafts: [
    { toEmail, toName, subject, body, inReplyTo, conversationId }
  ]
}
```

**Safe default:** `{ actionRequired: [], fyi: [], autoArchived: [], drafts: [] }`

---

### summarizeSlackMentions(mentions)

See `specs/04-slack.md` for full prompt guidance.

**Input:** array of mention objects (see spec 04 for shape)
**Max input:** 20; drop oldest first if over limit
**Max tokens:** 1000

**Prompt instructions:**
- For each mention, produce a one-line summary of what the user was asked or notified about
- Flag whether a reply seems expected

**Output shape:**
```js
[
  {
    channelName: "eng-general",
    user: "Alice Chen",
    summary: "Asked you to review PR #482 before end of day",
    needsReply: true,
    permalink: "https://..."
  }
]
```

**Safe default:** `[]`

---

### summarizeSlackDMs(directMessages)

**Input:** array of DM conversation objects (see spec 04 for shape)
**Max input:** pass all — typically low volume
**Max tokens:** 1000

**Prompt instructions:**
- For each DM thread, produce a 1-2 sentence summary of the conversation
- Flag if a reply from the user seems expected

**Output shape:**
```js
[
  {
    withUser: "Bob Smith",
    summary: "Wants to sync tomorrow about the Q2 roadmap.",
    replyExpected: true
  }
]
```

**Safe default:** `[]`

---

### summarizeSlackSection(sectionName, channels)

See `specs/04-slack.md` for full prompt guidance.

**Input:** section name (string) + array of channel objects with messages (user's own messages already filtered out)
**Max input:** 5 messages + 10 thread replies per channel before sending
**Max tokens:** 1000

**Prompt instructions:**
- Identify discussions where the user should consider engaging: open questions, architecture/technical decisions in progress, customer feedback or incidents, decisions affecting the user's work, announcements worth knowing
- Skip: trivial chatter, fully resolved discussions, status updates requiring no action, bot messages unless incident/alert/error
- Up to 5 concise bullets per channel framed as "what's happening and why it might need you"
- Omit channels where nothing warrants the user's attention

**Output shape:**
```js
[
  {
    channel: "eng-general",
    bullets: [
      "Open debate on moving to Postgres 16 — no decision yet, Alice asked for input",
      "Bob raised a concern about the auth token refresh edge case in the new flow"
    ]
  }
]
```

**Safe default:** `[]`

---

### summarizeSlackThreads(threadUpdates)

**Input:** array of thread update objects — threads the user previously replied to that have new replies from others
**Max input:** 15 thread updates
**Max tokens:** 1000

**Prompt instructions:**
- Each thread shows new replies from others after the user's last reply
- Determine whether the user should follow up
- Write one concise line per thread describing what happened and whether a response seems expected

**Output shape:**
```js
[
  {
    channelName: "eng-backend",
    parentText: "Should we use optimistic locking here?",
    summary: "Alice and Bob pushed back on the approach — waiting for your thoughts",
    needsReply: true
  }
]
```

**Safe default:** `[]`

---

### summarizeJira(issues)

**Input:** array of JIRA issue objects (see spec 06 for shape)
**Max input:** 30 issues; drop oldest-updated first if over limit
**Max tokens:** 1000

**Prompt instructions:**
- Separate into two groups framed around what the user should do today:
  - `actionRequired`: tickets where the user must act today (blocked on them, review requested, direct question, needs their decision or approval)
  - `updates`: tickets with open discussions, unresolved questions, or decisions in progress where the user's input could add value — even if not explicitly asked
- Write each summary as "why this might need you today", not just what changed
- Skip issues where: nothing new happened, only metadata changed, or the user already has the last word and no one has responded

**Output shape:**
```js
{
  actionRequired: [
    { key: "ENG-482", summary: "Alice is blocked on token refresh edge case — needs your review" }
  ],
  updates: [
    { key: "ENG-410", summary: "Debate on caching strategy — no decision yet, your input on trade-offs would help" }
  ]
}
```

**Safe default:** `{ actionRequired: [], updates: [] }`

---

### summarizeConfluence(pages)

**Input:** array of recently modified Confluence page objects (see spec 07 for shape)
**Max input:** 20 pages
**Max tokens:** 1000

**Prompt instructions:**
- Assess whether the user should review, comment, or respond to each page — not just that something changed
- Include pages where: the user was mentioned, there's an open question or RFC, significant decisions were added in the user's area, or being unaware could affect their work
- Skip pages where: the user made the last edit with no new replies, the edit is trivial (formatting, typos, version bump), or the content is purely informational with no engagement opportunity
- Write each summary as "why this might need your attention" rather than just what changed

**Output shape:**
```js
[
  {
    title: "Q1 Engineering Roadmap",
    space: "ENG",
    url: "https://...",
    summary: "Alice added mobile-first section to Q2 priorities — may affect your team's roadmap",
    needsAttention: false
  }
]
```

`needsAttention: true` if the user was mentioned or the change directly affects their work or decisions.

**Safe default:** `[]`

---

### summarizeGithub(notifications, label)

`label` is `'github.com'` or `'Corporate GitHub'` — included in action item attribution.

**Input:** array of enriched notification objects (see spec 08 for shape)
**Max input:** 30 notifications; pass all (already filtered by source)
**Max tokens:** 1000

**Prompt instructions:**
- Assess whether the user should act or engage with each notification — not just that something happened
- `needsAction: true` for: review_requested, assigned issues, CI failing on user's PR, direct mention/team_mention
- `needsAction: false` but still include if: PR they authored has unresolved comments or questions, open debate on a PR/issue they're watching, new unresolved info on assigned issues
- Skip: merged/resolved items with no open questions, bot/automated comments with no human discussion, pure status updates with no engagement opportunity
- Write each summary as "why this matters today", not just what happened

**Output shape:**
```js
[
  {
    id: "12345678",
    repo: "myorg/my-repo",
    title: "feat: add OAuth2 support",
    url: "https://...",
    summary: "Review requested — adds OAuth2 support to auth flow",
    needsAction: true
  }
]
```

**Safe default:** `[]`

---

### summarizeTeamsActivity(activities)

**Input:** array of Teams activity objects (see spec 05 for shape — to be written)
**Max input:** 50 activities
**Max tokens:** 1000

**Prompt instructions:**
- Focus on: mentions of the user, replies to the user's messages, reactions on important threads
- One line per activity: who, what, in which context
- Flag customer-related activity (channel name or context contains "customer" or "client")

**Output shape:**
```js
[
  {
    from: "Alice Chen",
    summary: "Replied to your message in #eng-general about the deployment",
    isCustomerRelated: false,
    timestamp: "2026-03-01T17:30:00Z"
  }
]
```

**Safe default:** `[]`

---

### summarizeMeetings(meetings)

**Input:** array of meeting objects with transcript text (see spec 05 for shape — to be written)
**Max input:** truncate each transcript to 4000 characters before sending
**Max tokens:** 1000 per meeting; call once per meeting, not all at once

**Prompt instructions:**
- 3-5 bullet points per meeting: key decisions, action items assigned to the user, open questions
- Keep it factual — do not infer tone or interpersonal dynamics
- If the transcript is empty or too short: return `"Transcript unavailable or too short to summarize"`

**Output shape:**
```js
[
  {
    title: "Q1 Planning",
    date: "2026-03-01",
    duration: "45 min",
    bullets: [
      "Decided to push mobile feature to Q3",
      "Action: user to share updated roadmap doc by Friday",
      "Open question: resourcing for backend migration"
    ]
  }
]
```

**Safe default:** `[]`

---

### synthesizeActionItems(allSummaries)

The final call. Takes all per-source summaries and produces a cross-source prioritized action list for the ⚡ Action Items section. Called **after** all source summaries are collected — not part of the `Promise.allSettled()` fetch phase.

**Input:**
```js
{
  email:      { actionRequired, drafts, ... },
  slack:      { mentions, dms, sections },
  teams:      { activities, meetings },
  jira:       { actionRequired, updates },
  confluence: [...],
  github:     { reviewRequested, mentioned, other },
  githubCorp: { reviewRequested, mentioned, other }
}
```

**Max tokens:** 1500

**Prompt instructions:**
- Produce a flat prioritized list of up to 10 action items
- Each item must include a source tag: `[Email]`, `[Slack]`, `[Teams]`, `[JIRA]`, `[Confluence]`, `[GitHub]`, `[GitHub Corp]`
- Deduplicate: if the same task appears in multiple sources, merge into one item and pick the most informative source tag
- Prioritize: time-sensitive or blocking items go first
- Informational updates are not action items — omit them
- Format each item as a plain-text one-liner: not a question, not a command (e.g. `"Reply to Jane re: Q1 roadmap — needed before Friday"`)

**Output shape:**
```js
[
  { source: "Email",  text: "Reply to Jane re: Q1 roadmap — needed before Friday" },
  { source: "JIRA",   text: "Review PR #482 — blocking release" },
  { source: "GitHub", text: "Approve dependabot PR on api-service" }
]
```

**Safe default:** `[]`

---

## Error Handling Summary

| Scenario | Behaviour |
|---|---|
| `ANTHROPIC_API_KEY` missing | Throw at module load time — this is fatal. Log: `[ai] ANTHROPIC_API_KEY not set` |
| API call fails (network, 5xx) | Log error with source name, return safe empty default for that function |
| Response is not valid JSON | Log warning with first 200 chars of raw response, return safe empty default |
| Rate limit (429) | Log warning, return safe empty default — do not retry (one daily run, no retry budget) |

---

## Notes for Implementation

- Instantiate the Anthropic client once at module level, not inside each function
- Pass source data as the `user` turn; keep behavioral instructions in `system`
- `synthesizeActionItems` is the only function that receives data from multiple sources — keep it that way
- The `callClaude` wrapper is internal — do not export it
