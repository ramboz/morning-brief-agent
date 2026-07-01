---
name: morning-slack
description: Slack sub-agent — plugin-first workflow (gather + digest + triage via Slack plugin tools, stage native Slack drafts when explicitly enabled). Supports Morning Brief and Deep Dive modes.
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

### Step 3 — DRAFT (native Slack drafts — only if `draft_enabled: true`)

Per [ADR-0005](../../docs/decisions/adr-0005-slack-plugin-native-drafts.md)
(Accepted), native Slack drafts (`slack_send_message_draft`) are the primary
reply-staging mechanism for Slack, superseding the DM-to-self mechanism in
[ADR-002](../../docs/decisions/ADR-002-draft-generation-and-delivery.md)'s
Slack row (JIRA/GitHub/Confluence in ADR-002 are unaffected).

**Skip this entire step unless `config/slack.json`'s `draft_enabled` is
exactly `true`.** Default is `false` — never draft without explicit opt-in
(AC1). This is a hard gate, not a soft preference: if the field is missing,
`false`, or anything other than the literal boolean `true`, do not call
`slack_send_message_draft` at all this run.

For each draft target identified in Step 2 ("Needs your reply/action" items
where a reply is clearly expected):

#### 3a. Generate draft text

Using the context already gathered in Step 1 (thread via `slack_read_thread`
if applicable), generate a draft reply:
- Keep it short (2-4 sentences), match the conversation tone
- If insufficient context: "Thanks — I'll look into this and get back to you shortly."
- Never fabricate technical facts or decisions
- `slack_send_message_draft`'s `message` field takes **standard markdown**
  (`**bold**`, `_italic_`, `` `code` ``, links) — not Slack mrkdwn. Do not
  use `<url|text>` syntax here.

**Do NOT draft for:** FYI messages, announcements, ambiguous contexts.

#### 3b. Stage via `slack_send_message_draft` (AC2 — preserve context)

Call with:
- `channel_id`: the channel/DM/group-DM ID the ask came from.
- `thread_ts`: the parent message's ts, **if replying inside a thread** —
  this anchors the draft as a threaded reply directly under the original
  ask, which is what "preserves context" means for a threaded item: no
  extra link needed, the source is right there.
- For a top-level (non-thread) message, omit `thread_ts` and instead open
  the draft text with a one-line quoted reference back to the source
  (`> @user asked: "..."`) plus its permalink (Step 1.4's construction
  rule), since there's no thread to anchor it visually.

On success, record the returned `channel_link` (the reviewable draft URL) —
surface this in the daily note (Output section), not a message permalink.

#### 3c. Handle `draft_already_exists` (AC3 — required, not optional)

**Scope of what's actually been verified:** the tool's own docs say
`draft_already_exists` fires when a channel/DM already has one attached
draft — but live testing (`slice-02-draft-test-2026-07-01.md`) could only
reproduce this against the user's own self-DM (the one destination
low-risk enough to test), and there it did NOT fire: repeat calls silently
updated the one attached draft in place instead, across both the
unthreaded and threaded creation paths. Treat the rule below as untested
for self-DM targets and expected-per-vendor-docs for everything else
(a channel/DM shared with someone else) until a real conflict is observed.

If the tool returns `draft_already_exists`: **stop for that specific
target** — do not retry, do not fall back to DM-to-self, do not attempt to
read or edit the existing draft (no such API is exposed; only one attached
draft is allowed per channel). Report it plainly in the Output section:
"@user already has a draft in `#channel` — skipped, review it directly in
Slack." Continue to the next draft target; one conflict never blocks the
rest of the run.

#### 3d. Other failures

`channel_not_found` / `failed_to_create_draft`: skip that target, log the
error, continue with the next one. Never escalate a draft failure into
sending — failures are reported, not worked around.

**Legacy DM-to-self mechanism (ADR-0002, superseded for Slack by ADR-0005):**
`scripts/stage-slack-draft.js` is no longer called by this workflow. It's
left in place pending slice 004-03's fallback/dead-code decision — see that
slice before deleting it.

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

6. **When `draft_enabled: true`, add a Staged Drafts section** (DoD, slice
   004-02) — one line per draft target: the `channel_link` for a created
   draft, or a plain skip note for a `draft_already_exists`/other failure.
   Omit this section entirely when `draft_enabled` is `false` — don't show
   an empty "no drafts" section on every run.

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

### Staged Drafts
_(only shown when `draft_enabled: true`)_
- ✅ **@sanjeev** — [draft ready to review](channel_link)
- ⚠️ **@razvan** in `#mysticat-engineering` — skipped, a draft already exists there; review it directly in Slack

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
| `channel_not_found` (plugin, gather) | Skip that channel, log it in the Coverage line, continue |
| Person not resolvable via `slack_search_users` | Skip that person, log it in the Coverage line, continue |
| Login screen (browser fallback) | Stop, report "Slack requires login" |
| `draft_enabled` is `false`/missing | Skip Step 3 entirely — no drafts this run, no error |
| `draft_already_exists` (Step 3) | Skip that draft target, report it in Staged Drafts, continue with the next — never overwrite or fall back |
| `channel_not_found`/`failed_to_create_draft` (Step 3) | Skip that draft target, log the error, continue |
