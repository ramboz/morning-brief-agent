---
name: morning-slack
description: Slack sub-agent — three-step workflow (gather via connector/API, analyze mentions/DMs/channels, stage drafts via Claude in Chrome). Supports Morning Brief and Deep Dive modes.
allowed-tools: bash, computer
---

# Morning Slack

## Load config

Read: `~/.claude/skills/morning-slack/config/slack-sections.json`

Extract: `sections` (priority channel groups), `emoji_triage.signals`, `ignore_bots`.

---

## Morning Brief Mode

### Step 1 — GATHER (fast)

**If gather_method = "connector":** Use the Cowork Slack connector to fetch:
- Unread mentions and DMs
- Threads with new replies where the user participated
- Messages in priority channels (from `sections` config) within the lookback window
- Messages where the user added emoji reactions (`:eyes:`, `:bookmark:`, `:pushpin:`)

**If gather_method = "script":** Run `node {scripts_path}/fetch-slack.js --brief` and parse the JSON output.

**If gather_method = "browser" (fallback):** Navigate to Slack (`https://app.slack.com`) via Claude in Chrome. Check for login. Scan Activity/Mentions, Threads, DMs, and priority channels by navigating the sidebar.

### Step 2 — ANALYZE (fast)

From the gathered data, classify and prioritize:

**Mentions & Threads** — Direct @mentions, thread replies where user is awaited. Priority: high.

**DMs** — Unread direct messages. Flag if reply expected.

**Priority Channels** — For each channel in `sections` config, summarize in 2-4 bullets:
- Open questions or debates needing user input
- Technical decisions without conclusion
- Incidents or customer issues
- Announcements worth knowing

**Filter out:** User's own messages, bot messages (unless incident/alert-related), trivial chatter.

**Emoji-flagged items** — Messages the user pre-flagged with `:eyes:`, `:bookmark:`, `:pushpin:` — surface these regardless of channel priority.

**Identify draft targets:** Mentions/DMs where a reply is clearly expected (direct question, ongoing thread where user is awaited).

### Step 3 — DRAFT (API-based — if draft_enabled)

For each draft target identified in Step 2:

#### 3a. Enrich context

Run: `node {scripts_path}/fetch-slack.js --context <channel_id> <thread_ts>`

This fetches the full thread (all replies, participants, timestamps) so the draft has enough context to be "ready to paste."

#### 3b. Generate draft text

Using the enriched context, generate a draft reply in **Slack mrkdwn format**:
- Keep it short (2-4 sentences), match the conversation tone
- If insufficient context: "Thanks — I'll look into this and get back to you shortly."
- Never fabricate technical facts or decisions
- Use Slack mrkdwn: `*bold*`, `_italic_`, `<url|text>` links, `@username` mentions

**Do NOT draft for:** FYI messages, announcements, ambiguous contexts.

#### 3c. Stage via DM-to-self

Pipe the draft to: `node {scripts_path}/stage-slack-draft.js`

Input (JSON on stdin):
```json
{
  "channel": "#channel-name",
  "permalink": "https://slack.com/archives/C.../p...",
  "summary": "One-line summary of what was asked",
  "draft": "The draft reply text in Slack mrkdwn",
  "target": "@username"
}
```

The script posts a formatted draft to the user's own DM channel (self-chat). Zero send risk — it's a message to yourself. The user reviews, then copies the draft text to the target channel.

Returns: `{ permalink, selfDmId, ts }` — use the permalink in the daily note's Staged Drafts table.

See: `docs/decisions/ADR-002-draft-generation-and-delivery.md`

### Output

Return to orchestrator:
- Daily note section (formatted markdown)
- Draft targets list (channel/DM + what the draft says)

### Daily note section format

**CRITICAL FORMATTING RULES — apply to EVERY line, no exceptions:**

1. **@-prefix ALL usernames** — write `@alice`, NEVER `alice`. Every single username in the output must start with `@`. This applies to message authors, mentions, and DM participants.

2. **Deep-link EVERY message** — every message bullet MUST contain a markdown link using the `permalink` field from the gathered data. No plain-text summaries without links. Format: `@user: [summary text](permalink)`. For threads: `([N replies](permalink))`.

3. **Deep-link channel names** — use the channel `url` field: `**[#channel-name](channel-url)**`

4. **Suppress empty channels** — if a priority channel had zero messages in the lookback window, omit it entirely

**If you write a message line without a permalink, you are doing it wrong. Go back and add the link.**

```markdown
### 🔴 Mentions & Threads
- 🔴 **[#eng-general](channel-url)** — @alice [asked for review on deployment plan](permalink) *(2h ago)* → [Draft staged]
- 📌 **[#roadmap](channel-url)** — You flagged this (:eyes:) — [Q2 mobile feature decision pending](permalink)

### Thread Updates
- ℹ️ **[#eng-backend](channel-url)** — "Optimistic locking?" — @alice and @bob pushed back, [waiting for your thoughts](permalink)

### Direct Messages
- **@bob** — [Wants to sync about Q2 planning](permalink) → [Draft staged]

### Engineering
- **[#eng-general](channel-url)** — 5 messages
  - @alice: [Deployed v2.4.1 to production](permalink) ✅
  - @bob: [Postgres 16 migration discussion](permalink) — no decision yet ([3 replies](thread-permalink))

### Other Channels
_12 channels had activity. No mentions._
```

**Self-check before returning:** Scan every line in your output. Does every username start with `@`? Does every message have a `[text](url)` link? If not, fix it before returning to the orchestrator.

---

## Deep Dive Mode

Answer the user's question about Slack. No draft staging unless asked.

**gather_method = "script":** Run `node {scripts_path}/fetch-slack.js --search "query terms"`
**gather_method = "connector":** Use connector search with keywords + date filters.
**gather_method = "browser":** Use Slack's search (Cmd+K) with keywords and date filters.

Return a direct, conversational answer with message excerpts and context.

---

## Error handling

| Scenario | Action |
|---|---|
| Connector/API unavailable | Try gather_fallback, then report error |
| Login screen (browser) | Stop, report "Slack requires login" |
| Channel not found | Skip, continue |
| SLACK_USER_TOKEN missing chat:write/im:write scopes | Skip drafts, log scope error, continue |
| stage-slack-draft.js fails | Skip that draft, log error, continue with next |
| --context returns empty thread | Draft with limited context, note in draft message |
