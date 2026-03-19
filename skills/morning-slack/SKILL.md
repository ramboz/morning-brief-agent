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

### Step 3 — DRAFT (slow, targeted — if draft_enabled)

For each draft target, use Claude in Chrome:

1. Navigate to the specific thread, channel, or DM in Slack
2. Click into the compose box at the bottom
3. Type a draft reply
4. **STOP — do NOT press Enter or click Send**
5. Leave the text in the compose box

**Draft guidance:**
- Keep it short (2-4 sentences), match the conversation tone
- If insufficient context: "Thanks — I'll look into this and get back to you shortly."
- Never fabricate technical facts or decisions

**Do NOT draft for:** FYI messages, announcements, ambiguous contexts.

### Output

Return to orchestrator:
- Daily note section (formatted markdown)
- Draft targets list (channel/DM + what the draft says)

### Daily note section format

```markdown
### 🔴 Mentions & Threads
- 🔴 **#eng-general** — Alice asked for review on deployment plan *(2h ago)* → [Draft staged]
- 📌 **#roadmap** — You flagged this (:eyes:) — Q2 mobile feature decision pending

### Thread Updates
- ℹ️ **#eng-backend** — "Optimistic locking?" — Alice and Bob pushed back, waiting for your thoughts

### Direct Messages
- **Bob Smith** — Wants to sync about Q2 planning → [Draft staged]

### Engineering
#### #eng-general
- Deployed v2.4.1 to production ✅
- Postgres 16 migration discussion — no decision yet

### Other Channels
_12 channels had activity. No mentions._

### Staged Drafts (3)
1. #eng-general → Reply to Alice re: deployment plan
2. #incidents → Acknowledgment of post-mortem assignment
3. DM Bob Smith → Confirm sync tomorrow
```

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
| Compose box not accessible | Skip draft, log, continue |
