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
**Max input:** 100 — already enforced by search API
**Max tokens:** 1000

**Prompt instructions:**
- Produce a one-line summary per mention with enough context to understand what's being asked
- Flag urgent items (P1 incidents, blockers, explicit deadlines)

**Output shape:**
```js
[
  {
    channelName: "eng-general",
    text: "Alice Chen asked you to review PR #482",
    urgent: false,
    ts: "1709298180.000200"
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

**Input:** section name (string) + array of channel objects with messages
**Max input:** truncate each channel to its 100 most recent messages before sending
**Max tokens:** 1000

**Prompt instructions:**
- Key decisions or announcements worth knowing
- Action items involving the user (flag with 🔴)
- Significant discussions worth being aware of (flag with ℹ️)
- Skip: automated bot messages (unless incident/failure), emoji-only messages, trivial chatter
- Max 5 bullet points per channel; summarize at a higher level if more happened

**Output shape:**
```js
{
  sectionName: "Engineering",
  channels: [
    {
      name: "eng-general",
      bullets: [
        "Deployed v2.4.1 to production (Alice Chen)",
        "Discussion on Postgres 16 migration — no decision yet"
      ]
    }
  ]
}
```

**Safe default:** `{ sectionName, channels: [] }`

---

### summarizeJira(issues)

**Input:** array of JIRA issue objects (see spec 06 for shape — to be written)
**Max input:** 30 issues; drop oldest-updated first if over limit
**Max tokens:** 1000

**Prompt instructions:**
- Separate into two groups: tickets needing user action, and informational updates
- For action items: ticket key, one-line description of what action is needed
- For updates: ticket key, one line of what changed
- Skip issues with no meaningful activity (pure metadata changes, field updates with no comments)

**Output shape:**
```js
{
  actionRequired: [
    { key: "ENG-482", summary: "Review PR — blocking release, assignee waiting on you" }
  ],
  updates: [
    { key: "ENG-410", summary: "Status changed to In Review by Alice" }
  ]
}
```

**Safe default:** `{ actionRequired: [], updates: [] }`

---

### summarizeConfluence(pages)

**Input:** array of recently modified Confluence page objects (see spec 07 for shape — to be written)
**Max input:** 20 pages
**Max tokens:** 1000

**Prompt instructions:**
- One-line summary per page: what changed and who changed it
- Flag if the page is in a space the user owns or was recently active in (use space key from input)
- Skip trivial edits if the excerpt doesn't show meaningful content change

**Output shape:**
```js
[
  {
    title: "Q1 Engineering Roadmap",
    space: "ENG",
    url: "https://...",
    summary: "Updated by Alice Chen — added mobile section to Q2 priorities",
    needsAttention: false
  }
]
```

**Safe default:** `[]`

---

### summarizeGithub(notifications, label)

`label` is `'github.com'` or `'Corporate GitHub'` — included in action item attribution.

**Input:** array of notification objects (see spec 08 for shape — to be written)
**Max input:** 50 notifications per instance; drop oldest first if over limit
**Max tokens:** 1000

**Prompt instructions:**
- Group by type: PRs awaiting review, mentions/comments needing response, CI failures, other
- Flag PRs where the user is a requested reviewer
- Skip purely informational notifications (merged PRs, closed issues) unless follow-up is likely needed

**Output shape:**
```js
{
  reviewRequested: [
    { repo: "org/api-service", title: "Add rate limiting middleware", url: "https://..." }
  ],
  mentioned: [
    { repo: "org/frontend", title: "Bug: login redirect loop", url: "https://..." }
  ],
  other: [
    { repo: "org/infra", title: "Dependabot: bump lodash to 4.17.21", url: "https://..." }
  ]
}
```

**Safe default:** `{ reviewRequested: [], mentioned: [], other: [] }`

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
