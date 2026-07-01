---
name: morning-slack
description: Slack sub-agent — plugin-first workflow (gather via Slack plugin tools, analyze mentions/DMs/channels, stage drafts via Claude in Chrome or native Slack drafts). Supports Morning Brief and Deep Dive modes.
allowed-tools: bash, computer
---

# Morning Slack

Per [ADR-0005](../../docs/decisions/adr-0005-slack-plugin-native-drafts.md) and
[spec 004](../../docs/specs/004-slack-plugin-triage/spec.md), the Slack plugin
(the `slack_*` tools available in the active session) is the primary path for
gather + digest + triage. `scripts/fetch-slack.js` is fallback/reference
material only — see slice 004-03 for the fallback boundary once it's written.

This skill runs in an interactive session because the `slack_*` tools require
one — it is not wired into the headless `scripts/write-brief.js` composer
(which currently only runs AI Radar). See "Legacy Cowork skill layer" in
[docs/refinement-todo.md](../../docs/refinement-todo.md) for why these two
stay separate for now.

## Load config

Read: `{scripts_path}/../config/slack.json`

Extract: `sections` (each with `channels` and `people` — the explicit,
user-provided scope). This workflow never claims workspace-wide Slack
coverage — only `sections` is ever read.

---

## Morning Brief Mode

### Step 1 — GATHER (fast)

**Primary — Slack plugin tools:**
1. For each channel in every `sections[].channels`, resolve its ID with
   `slack_search_channels` (cache the id — channel names don't change often)
   and pull the lookback window with `slack_read_channel` (`oldest` = brief
   lookback start, `response_format: "concise"`).
2. For each person in every `sections[].people`, resolve their Slack user ID
   with `slack_search_users`, then pull DM/group-DM history for the lookback
   window with `slack_read_channel` (a `user_id` works directly as
   `channel_id` for 1:1 DMs; group DMs need the DM channel's own id, found via
   the same search or a prior `slack_search_public_and_private` result).
3. For any message with replies, use `slack_read_thread` to pull the full
   thread before summarizing it.
4. `slack_read_channel`/`slack_read_thread` do not return a `permalink`
   field — construct it as `https://adobe.enterprise.slack.com/archives/<channel_id>/p<message_ts with the dot removed>`
   (verified against real `slack_search_public_and_private` permalinks —
   the Enterprise Grid-wide domain resolves correctly for every workspace).
   This construction is identical for public/private channel IDs (`C...`)
   and DM/group-DM channel IDs (`D...`) — the same `<channel_id>/p<ts>` shape
   works for both; there is no separate DM permalink format. Only fall back
   to `slack_search_public_and_private` for a permalink if a message has no
   ts you can read directly (e.g. it only reached you via a "Forwarded
   message" reference).

**If the plugin is unavailable:** fall back to `node {scripts_path}/fetch-slack.js --brief` (parse the JSON envelope), then to browser navigation
(`https://app.slack.com` via Claude in Chrome) as a last resort. Note which
path was used in the output — never silently substitute one for another.

**Track coverage as you go**, per `sections` entry — four possible states:
- **quiet** — resolved to an ID, zero messages in the lookback window.
- **active outside window** — resolved, has messages, but they fall just
  outside the lookback window (say so rather than lumping it in with quiet).
- **unresolved** — couldn't resolve the name to a Slack ID this run.
- **excluded by design** — deliberately dropped from `sections` (e.g. an
  ephemeral/rotational channel name) — record the reason once in
  `config/slack.json`'s `note` field, not per-run.

This feeds the Coverage note in Step 2/Output. Do not expand scope beyond
`sections` to compensate for a quiet or unresolved entry.

### Step 2 — ANALYZE (fast)

From the gathered data, classify and prioritize:

**Needs your reply/action** — Direct @mentions, DMs, or threads where you're
the addressee or a reply is clearly expected (including your own open
questions still awaiting a reply). Priority: high.

**Worth skimming** — Decisions, blockers, ownership changes, incidents, and
deadlines surfaced in `sections` channels/DMs that don't need a reply from
you, but you should know about.

**Filter out:** User's own routine messages, bot messages (unless
incident/alert-related), trivial chatter.

**Emoji-flagged items** — Messages the user pre-flagged with `:eyes:`,
`:bookmark:`, `:pushpin:` (`emoji_triage.signals` in config) — surface these
regardless of section.

**Identify draft targets:** Mentions/DMs where a reply is clearly expected
(direct question, ongoing thread where user is awaited).

**Coverage note (required, per AC1):** report all four states tracked in
Step 1 — quiet, active-outside-window, unresolved, excluded-by-design —
rather than omitting any silently. A short "nothing new in X, Y" /
"Z had activity just outside the window" / "couldn't resolve W to a Slack ID
this run" / "V excluded — ephemeral/rotational, see config note" line per
state is enough. Never imply full workspace coverage.

### Step 3 — DRAFT (API-based — if draft_enabled)

Native Slack drafts (`slack_send_message_draft`) are the target mechanism
once [ADR-0005](../../docs/decisions/adr-0005-slack-plugin-native-drafts.md)
is accepted and slice 004-02 lands — see that slice for the
`draft_already_exists` conflict handling this requires. Until then, this step
stays on the DM-to-self mechanism below (ADR-0002).

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

4. **Drop empty channels/DMs from the main listing** — if a `sections` entry had zero messages in the lookback window, don't give it a bullet there — but it still belongs in the Coverage line (rule 5), never silently.

5. **Always end with a Coverage section** — one line per state tracked in Step 1 (quiet / active-outside-window / unresolved / excluded-by-design), naming which `sections` entries fall into each. This is what keeps the scope honest per AC1 — omitting any state is treated as a bug in this workflow, not a formatting nicety.

**If you write a message line without a permalink, you are doing it wrong. Go back and add the link.**

```markdown
### Needs your reply/action
- 🔴 **[#auto-optimize-core-team](channel-url)** — your [ADR agreement ask](permalink) to @lucian/@dragos is still open, blocking 2 follow-up specs
- 🔴 **@sanjeev** — your [reimbursement question](permalink) is still unanswered (they were OOO)
- 🔴 **[#mysticat-engineering](channel-url)** — @razvan [asked for a PR review](permalink) on a small change

### Worth skimming
- ℹ️ **[#auto-optimize-core-team](channel-url)** — @daniel [flagged customer timeouts](permalink) (Casio down), proposed disabling automatic schedules, awaiting @lucian's input
- ℹ️ **[#aem-sites-optimizer-engineering](channel-url)** — @jiang [flagged a potential repeat outage](permalink) if ASO-originated requests aren't blocked
- ℹ️ **[#aem-sites-optimizer-engineering](channel-url)** — @hanish shipped a [30s→instant search fix](permalink) for the Backoffice sites page

### Coverage
_Quiet this run: #aem-sites-optimizer-cwv, #aem-offer-management, #ai-native-acceleration, #xp-success-bayarea-social, @lucian, @francisco, @dereje, and 2 group DMs.
Active just outside the lookback window: #learning-agent-collaboration.
Not resolved to a Slack ID this run: @kunwar, @amol, @sagar, @gilbert, @serhii, @xinyi, @audrey, @jeddie, @olena-kochis, @jim, @iulia, @dominique, @dirk.
Excluded by design: AEM oncall (#autosky, shift-dated #skyline-oncall-* channels) — ephemeral/rotational, see config/slack.json's note field._
```

**Self-check before returning:** Scan every line in your output. Does every username start with `@`? Does every message have a `[text](url)` link? Is there a Coverage line? If not, fix it before returning to the orchestrator.

---

## Deep Dive Mode

Answer the user's question about Slack. No draft staging unless asked.

**Primary — Slack plugin:** Use `slack_search_public_and_private` (or
`slack_search_public`) with the user's keywords plus date/channel modifiers,
scoped to `sections` unless the user explicitly asks to search wider.
**Fallback — script:** Run `node {scripts_path}/fetch-slack.js --search "query terms"`.
**Fallback — browser:** Use Slack's search (Cmd+K) with keywords and date filters.

Return a direct, conversational answer with message excerpts and context.

---

## Error handling

| Scenario | Action |
|---|---|
| Slack plugin unavailable | Fall back to script, then browser; report which path was used |
| `channel_not_found` (plugin) | Skip that channel, log it in the Coverage line, continue |
| Person not resolvable via `slack_search_users` | Skip that person, log it in the Coverage line, continue |
| Connector/API unavailable | Try gather_fallback, then report error |
| Login screen (browser) | Stop, report "Slack requires login" |
| Channel not found | Skip, continue |
| SLACK_USER_TOKEN missing chat:write/im:write scopes | Skip drafts, log scope error, continue |
| stage-slack-draft.js fails | Skip that draft, log error, continue with next |
| --context returns empty thread | Draft with limited context, note in draft message |
