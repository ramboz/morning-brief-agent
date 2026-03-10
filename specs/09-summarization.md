# Spec 09 — Summarization (Claude API)

## Overview

`src/ai/summarize.js` is the **only** file that calls the Claude API. Every source has its own summarization function. All prompts are stored as named constants at the top of the file, not inline strings. A final synthesis function combines all source summaries into the ⚡ Action Items section.

---

## Backend Setup

Two AI backends are supported, selected via `AI_BACKEND` env var:

- **`claude-cli` (default):** Invokes `claude -p "<prompt>"` as a subprocess. No API key needed — uses the user's existing Claude subscription. Supports `--model <name>` override via the `aiModel` flag from `src/utils/flags.js`.
- **`openai`:** Calls an OpenAI-compatible chat completions API (`OPENAI_BASE_URL`). Uses `response_format.json_schema` for structured output enforcement.

```js
const AI_BACKEND = process.env.AI_BACKEND ?? 'claude-cli'
```

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
async function callClaude(prompt, userContent, opts = {}) {
  const { maxTokens = 1000, schema } = opts
  if (AI_BACKEND === 'openai') {
    return callOpenAI(prompt, userContent, maxTokens, schema)
  }
  return callClaudeCLI(prompt, userContent, schema)
}
```

- `callClaudeCLI` spawns `claude -p` as a subprocess with a configurable timeout (`AI_TIMEOUT_MS`, default 5 min). If `aiModel` is set (via `--model` flag), passes `--model <name>` to the CLI.
- `callOpenAI` calls the configured chat completions endpoint. When a `schema` is provided, it's passed via `response_format.json_schema` for structured output.

All summarization functions use `callClaude` as the entry point. Errors are caught in each caller.

### JSON response handling

The Claude CLI sometimes wraps JSON output in markdown code fences (`` ```json ... ``` ``). A `parseJSONResponse()` helper strips these before parsing:

```js
function parseJSONResponse(text) {
  const stripped = text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '')
  return JSON.parse(stripped)
}
```

### JSON schemas

Each summarization function has a corresponding `SCHEMA_X` constant that defines the expected output shape. These are used by the OpenAI backend via `response_format.json_schema` for structured output enforcement. The `claude-cli` backend relies on prompt instructions and `parseJSONResponse` instead.

### Error pattern

```js
async function summarizeX(data) {
  try {
    const text = await callClaude(PROMPT_X, JSON.stringify(data), { schema: SCHEMA_X })
    return parseJSONResponse(text)
  } catch (err) {
    console.error('[ai] summarizeX failed:', err.message)
    return /* safe default for this function */
  }
}
```

If the AI backend is unavailable, the section appears as `_Summarization unavailable._` in the daily note rather than crashing the run.

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
- For each DM conversation, produce a 1-2 sentence summary of the conversation
- Flag if a reply from the user seems expected
- Pass through `dmId` from input as `dmChannelId` (used by the renderer for deep links)
- **Noise filtering:** omit conversations where the only messages are simple acknowledgments ("thanks", "got it"), the conversation is fully resolved, or the content is purely social with no work relevance

**Output shape:**
```js
[
  {
    withUser: "Bob Smith",
    dmChannelId: "D012AB3CD",
    summary: "Wants to sync tomorrow about the Q2 roadmap.",
    replyExpected: true
  }
]
```

**Safe default:** `[]`

---

### summarizeSlackChannels(channels)

See `specs/04-slack.md` for full prompt guidance.

**Input:** array of channel objects with messages (user's own messages already filtered out)
**Max input:** 5 messages + 10 thread replies per channel before sending
**Max tokens:** 1000

**Prompt instructions:**
- Identify discussions where the user should consider engaging: open questions, architecture/technical decisions in progress, customer feedback or incidents, decisions affecting the user's work, announcements worth knowing
- **Noise filtering** — skip these explicitly: simple acknowledgments/emoji-only messages, greetings/social chatter, fully resolved discussions, non-actionable status updates, bot messages unless they contain incident/alert/error keywords, thread replies that are only acks of a resolved question
- Up to 5 concise bullets per channel framed as "what's happening and why it might need you"
- Omit channels where nothing warrants the user's attention
- **Each channel must appear at most ONCE in the output.** Do not split a channel into multiple entries.

**Post-processing:** After parsing the AI response, merge any duplicate channel entries by channel name (normalised: lowercase, strip leading `#`). This guards against the AI occasionally splitting a channel across multiple JSON entries.

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
- Pass through `channelId` and `threadTs` from input (used by the renderer for deep links)
- **Noise filtering:** omit threads where the only new replies are simple acknowledgments ("thanks", "got it", "will do", emoji-only), bot noise, or redundant status updates. Include threads with follow-up questions, pushback, new decisions, or blockers.

**Output shape:**
```js
[
  {
    channelName: "eng-backend",
    channelId: "C012AB3CD",
    threadTs: "1234567890.123456",
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

The final synthesis call. Takes all per-source summaries and produces a cross-source prioritized action list for the ⚡ Action Items section. Called **after** all per-source summarizations complete — run in parallel with `synthesizeProjectClusters()`.

**Current scope (Phase 8):** 4 active sources. Input shape will expand when Email and Teams are added.

**Input:**
```js
{
  jira:       { actionRequired: [...], updates: [...] },
  confluence: [...],                              // from summarizeConfluence()
  github:     [...],                              // from summarizeGithub() — github.com
  githubCorp: [...],                              // from summarizeGithub() — corporate GHE
  slackMentions:  [...],                          // from summarizeSlackMentions()
  slackThreads:   [...],                          // from summarizeSlackThreads()
  slackDMs:       [...],                          // from summarizeSlackDMs()
  // future: email, teams
}
```

Each array contains already-summarized items from the per-source functions. Do not re-summarize raw API data here.

**Max tokens:** 1500

**Prompt instructions:**
- Produce a flat prioritized list of up to 10 action items
- Each item must include a source tag: `[Slack]`, `[JIRA]`, `[Confluence]`, `[GitHub]`, `[GitHub Corp]` (expand when Email/Teams added)
- Deduplicate: if the same task appears in multiple sources, merge into one item and pick the most informative source tag
- Prioritize: time-sensitive or blocking items first (review_requested, blocked on you, direct question); informational updates are not action items — omit them
- Write each item as a plain-text one-liner stating the action and why it matters today

**Output shape:**
```js
[
  { source: "JIRA",       text: "ENG-482 — Alice is blocked on token refresh, needs your review", url: "https://jira.../browse/ENG-482" },
  { source: "GitHub",     text: "PR: feat/auth — review requested, adds OAuth2 support",           url: "https://github.com/..." },
  { source: "Slack",      text: "#eng-backend — unresolved question on caching approach, you were asked", permalink: "https://..." }
]
```

**Rendered format in daily note** (via `renderActionItems()` in `dailyNote.js`):
```
- [ ] [JIRA] [ENG-482](https://jira.../browse/ENG-482) — Alice is blocked on token refresh, needs your review
- [ ] [GitHub] [PR: feat/auth](https://github.com/...) — review requested, adds OAuth2 support
- [ ] [Slack] [#eng-backend](https://...) — unresolved question on caching approach, you were asked
```

For Slack items: `[Slack] [#channel](permalink) — summary`.
For JIRA/GitHub items with URLs: ticket/PR reference is linked.

**Safe default:** `[]`

---

### synthesizeProjectClusters(allSummaries)

A synthesis call that groups items from different sources into cross-source "focus areas" — projects or topics where multiple signals converged today. This becomes the 🔥 Focus Areas section.

Called **in parallel** with `synthesizeActionItems()` after all per-source summarizations complete.

**Input:** same shape as `synthesizeActionItems()` — all per-source summaries.

**Max tokens:** 1000

**Prompt instructions:**
- Identify recurring themes, projects, or features across sources — things showing up in 2 or more sources
- Each cluster represents one project/topic with signals from multiple sources
- Do not create clusters for items appearing in only one source
- Sort by signal count descending (most cross-source activity first)
- Max 5 clusters — only the most active topics
- For each cluster, write one concise line per source signal (what happened in that source regarding this topic)
- Name clusters after the project, feature, or system they represent (e.g. "Auth Service", "Q2 Roadmap", "API Gateway migration")

**Output shape:**
```js
[
  {
    name: "Auth Service",
    signals: [
      { source: "JIRA",   summary: "ENG-482 blocked — token refresh edge case", url: "https://jira.../browse/ENG-482" },
      { source: "GitHub", summary: "PR #91 — review requested for OAuth2 changes", url: "https://github.com/..." },
      { source: "Slack",  summary: "3 mentions in #eng-backend about token refresh failures" }
    ]
  },
  {
    name: "Q2 Roadmap",
    signals: [
      { source: "Wiki", summary: "Alice added mobile-first section — may affect your team", url: "https://confluence.../..." },
      { source: "JIRA",       summary: "ENG-410 — debate on caching strategy open, your input wanted", url: "https://jira.../browse/ENG-410" }
    ]
  }
]
```

**Rendered format in daily note** (via `renderProjectClusters()` in `dailyNote.js`):
```
### Auth Service
- [JIRA] [ENG-482](https://jira.../browse/ENG-482) — blocked, token refresh edge case
- [GitHub] [PR #91](https://github.com/...) — review requested for OAuth2 changes
- [Slack] 3 mentions in #eng-backend about token refresh failures

### Q2 Roadmap
- [Confluence] [Q2 Roadmap](https://confluence.../...) — Alice added mobile-first section
- [JIRA] [ENG-410](https://jira.../browse/ENG-410) — caching debate open, your input wanted
```

**Safe default:** `[]` (section shows "_Nothing to report._" — no clusters means no cross-source overlap today)

---

## Error Handling Summary

| Scenario | Behaviour |
|---|---|
| `AI_BACKEND=openai` but `OPENAI_API_KEY` missing | Log error at startup: `[ai] OPENAI_API_KEY not set — summarization will fail` |
| `claude-cli` timeout (exceeds `AI_TIMEOUT_MS`) | Kill subprocess, log error with PID and elapsed time, reject with timeout error |
| `claude-cli` empty response | Reject with clear error: `claude CLI returned empty response` |
| API call fails (network, 5xx) | Log error with source name, return safe empty default for that function |
| Response is not valid JSON | Log warning with first 200 chars of raw response, return safe empty default |
| Rate limit (429) | Log warning, return safe empty default — do not retry (one daily run, no retry budget) |

---

## Notes for Implementation

- `callClaude`, `callClaudeCLI`, `callOpenAI`, and `parseJSONResponse` are internal — do not export them
- For `claude-cli`: system prompt and user content are combined into a single `-p` string (no separate system/user turns)
- For `openai`: system prompt is the `system` turn, user content is the `user` turn
- `synthesizeActionItems` and `synthesizeProjectClusters` are the only functions that receive data from multiple sources — keep it that way
- Both synthesis functions are called in parallel with `Promise.all()` after per-source summarizations complete (it's acceptable to fail the entire synthesis together since they share input)
- JSON schemas live as `const SCHEMA_X = ...` constants alongside their corresponding `PROMPT_X` constants
