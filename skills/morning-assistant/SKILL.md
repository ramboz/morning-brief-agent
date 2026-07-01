---
name: morning-assistant
description: Morning briefing orchestrator — two modes (Morning Brief + Deep Dive). Coordinates sub-agents across three layers (orchestration, data gathering, draft staging). Writes daily note to Obsidian vault.
allowed-tools: bash, computer
---

# Morning Assistant (Orchestrator)

You run in two modes. Detect which applies, then follow the corresponding workflow.

## Detect Mode

**Morning Brief** — user says "Run my morning brief", "morning brief", "daily brief", or similar.
**Deep Dive** — user asks a specific question: "What's the latest on Project X?", "Catch me up on ENG-482", "What has Alice been working on?", etc.

---

# Morning Brief Mode

## Step 0 — Load config

Read: `{scripts_path}/../config/main.json`

If missing, stop:
> Config not found. Copy `main.example.json` to `main.json` and fill in your settings.

Extract:
- `vault_path`, `daily_notes_folder`, `scripts_path`
- `lookback_hours` (default 24; auto-72h on Mondays)
- `tools` — per-tool config with `enabled`, `gather_method`, `draft_enabled`
- `dry_run` — if `true` (or `--dry-run` CLI flag), skip all draft staging (Steps 1-3 run normally)

Try to load: `~/.claude/skills/morning-assistant/state/last-run.json`

### Stale config check

For each enabled tool, check if its config file was last modified more than 30 days ago. If stale, add a warning to the daily note footer:

```
⚠️ Config warning: slack.json last modified 45 days ago — channels may have changed
```

This uses the `checkConfigAge()` helper from `scripts/lib/config.js`.

## Step 1 — Gather data (Layer 2 — fast)

Spawn sub-agents per enabled tool, **in parallel where possible**. Each sub-agent follows the three-step pattern defined in its SKILL.md.

**Per-tool gather strategy** (from config):

| gather_method | What the sub-agent does |
|---|---|
| `connector` | Use the Cowork connector for that tool |
| `script` | Run `node {scripts_path}/fetch-{tool}.js --brief` and parse stdout JSON |
| `browser` | Fall back to browsing the tool's web UI via Claude in Chrome |

If `gather_fallback` is set and the primary method fails, try the fallback.

**Tool sub-agents to invoke:**
- `morning-slack` — mentions, DMs, threads, priority channels
- `morning-outlook` — email triage, Teams activity
- `morning-jira` — assigned tickets, discussions, mentions
- `morning-confluence` — page changes, mentions (read-only)
- `morning-github` — PR reviews, notifications (both instances)
- `morning-ai-radar` — RSS/trending triage (read-only)

**If a tool fails**: note the error, skip it, continue. Never let one tool block others.

## Step 2 — Analyze and synthesize (Layer 1)

Collect results from all sub-agents. Synthesize a unified Action Items list (max 10), ranked by priority:

1. Direct questions / explicit requests mentioning the user
2. Items with deadlines
3. Ongoing discussions where the user is awaited
4. FYI / awareness items

**Use relative timestamps** for all items. Instead of "2026-03-23T14:30:00Z", write "2h ago" or "yesterday". The `timeAgo()` utility from `scripts/lib/config.js` provides this formatting.

## Step 3 — Write the daily note

Write to: `{vault_path}/{daily_notes_folder}/{YYYY-MM-DD}.md`

```markdown
# Daily Brief — {YYYY-MM-DD}

## Action Items
<!-- AGENT:action_items -->
- [ ] 🔴 **Reply to VP Engineering** (Email) — Q2 budget, due Friday → [Draft in Outlook]
- [ ] 🔴 **Review PR #482** (GitHub) — Retry logic, 2h ago → [Pending review staged](https://...)
- [ ] 🟡 **Reply to Alice** (Slack) — auth migration thread, yesterday → [Draft in DMs](https://...)
- [ ] 🟡 **Reply on SITES-1234** (JIRA) — deployment question → [[2026-03-23-jira-SITES-1234-comment]]
- [ ] ℹ️ **Read: Q2 Planning** (Confluence) — updated by Bob (3 sections changed), 5h ago
<!-- /AGENT:action_items -->

## 💬 Slack
<!-- AGENT:slack -->
{from morning-slack sub-agent}
<!-- /AGENT:slack -->

## 📬 Email
<!-- AGENT:outlook -->
{from morning-outlook sub-agent}
<!-- /AGENT:outlook -->

## 🎫 JIRA
<!-- AGENT:jira -->
{from morning-jira sub-agent}
<!-- /AGENT:jira -->

## 📖 Confluence
<!-- AGENT:confluence -->
{from morning-confluence sub-agent}
<!-- /AGENT:confluence -->

## 💻 GitHub
<!-- AGENT:github -->
{from morning-github sub-agent}
<!-- /AGENT:github -->

## 🤖 AI Radar
<!-- AGENT:ai_radar -->
{from morning-ai-radar sub-agent}
<!-- /AGENT:ai_radar -->

---
*Generated at {HH:MM} {TZ} — Lookback: {N}h — Duration: {Xm Ys}*
*Agent: Morning Assistant v2 (Cowork Hybrid)*
```

### Formatting rules

**Unified Action Items checklist:** The Action Items section is a single `- [ ]` checklist combining both action items and staged drafts. Each item includes the tool source, a relative timestamp, and a link to the draft (DM permalink, vault wikilink, or PR URL). The user can tick items off in Obsidian as they work through them.

**CRITICAL — Deep links in Action Items:** Every action item MUST include a clickable deep link to the source item. Use the `url`/`permalink` fields from the gathered data:
- Email: `[Subject](https://outlook.office.com/mail/inbox/id/...)` — use the `url` field from email data
- Slack: `[summary](permalink)` — use the `permalink` field from message data
- JIRA: `[SITES-1234](https://jira.corp.adobe.com/browse/SITES-1234)` — use the `url` field from issue data
- GitHub: `[PR #482](https://github.com/...)` — use the `url` field from notification data
- Confluence: `[Page Title](https://wiki.corp.adobe.com/...)` — use the `url` field from page data
- Calendar: include the `onlineMeetingUrl` (Teams link) when available

Example with deep links:
```
- [ ] 🔴 **[Review PR #482](https://github.com/org/repo/pull/482)** (GitHub) — Retry logic, 2h ago
- [ ] 🟡 **[Reply to Alice](https://slack.com/archives/C.../p...)** (Slack) — auth migration thread, yesterday
- [ ] 🟡 **[SITES-1234](https://jira.corp.adobe.com/browse/SITES-1234)** (JIRA) — deployment question
- [ ] ℹ️ **[Q2 Planning](https://wiki.corp.adobe.com/...)** (Confluence) — updated by Bob, 5h ago
```

If a deep link URL is not available for an item, still include the item but without a link. Never omit an action item just because the URL is missing.

**Section suppression:** If a tool returns zero items (no mentions, no updates, nothing actionable), **omit its section entirely** from the daily note. Do not include empty headers or "Nothing to report." lines — this reduces noise. Only include sections that have content.

Exception: If a tool was enabled but *failed* (API error, timeout), include the section with a one-line error note: `_JIRA: unavailable — connection refused_`

**Relative timestamps:** Use `timeAgo()` formatting throughout — both in action items and in per-tool sections. Examples: "2h ago", "yesterday", "3d ago".

**Re-run / smart merge:** If the file already exists, replace only content between matching `<!-- AGENT:{key} -->` / `<!-- /AGENT:{key} -->` anchors. Preserve everything else (including user edits, checked checkboxes).

## Step 4 — Clean up old drafts, then stage new ones

**If `dry_run` is enabled:** Skip this entire step. Add a note to the daily note footer: `_Dry-run mode — draft staging skipped_`

### Draft cleanup (runs first)

Run `node {scripts_path}/cleanup-drafts.js --vault {vault_path} --days 3` to remove draft fragments older than 3 days. This keeps the `{vault}/drafts/` folder tidy. Log the result (N deleted, N kept) but don't block the brief if cleanup fails.

### Stage drafts (per-tool delivery)

For each tool that identified draft targets in Step 2, stage drafts using the tool's delivery method. Only stage drafts for tools where `draft_enabled: true` in config.

### Draft delivery methods by tool

| Tool | Method | How |
|---|---|---|
| Slack | **Native draft** (plugin API) | Handled entirely inside the `morning-slack` sub-agent's own Step 3 — see below |
| JIRA | **Local MD fragment** | Write draft comment to `{vault}/drafts/YYYY-MM-DD-jira-{KEY}-comment.md` |
| GitHub Issues | **Local MD fragment** | Write draft comment to `{vault}/drafts/YYYY-MM-DD-github-{repo}-{num}-comment.md` |
| GitHub PRs | **Pending review** (API) | Stage review comments via GitHub API (pending, not submitted) |
| Confluence | None | Read-only — no drafts |
| Outlook | **Browser** (deferred) | Claude in Chrome to compose draft email (Phase 3) |

See: `docs/decisions/ADR-002-draft-generation-and-delivery.md` (JIRA/GitHub/Confluence/Outlook
rows) and [ADR-0005](../../docs/decisions/adr-0005-slack-plugin-native-drafts.md) (Slack row,
superseding ADR-002's DM-to-self mechanism for Slack only).

### Slack drafts — no separate orchestrator step

Unlike the other tools, the orchestrator does **not** run a separate
enrich/generate/stage pass for Slack. The `morning-slack` sub-agent stages
native Slack drafts itself (`slack_send_message_draft`, gated on
`config/slack.json`'s `draft_enabled`) as part of its own Step 3 and returns
the already-staged results — see
[`skills/morning-slack/SKILL.md`](../morning-slack/SKILL.md). `scripts/stage-slack-draft.js`
(the old DM-to-self staging script) was retired in slice `004-03`: native
drafts fully superseded it and no fallback draft path remains. **If the
Slack plugin was unavailable this run** (Step 1 fell back to script or
browser for gather), there is no draft fallback either — Slack drafting is
skipped for that run; the Coverage note in the Slack section says so rather
than silently omitting drafts.

### JIRA / GitHub issue draft pipeline (local MD fragments)

1. Write a markdown file to `{vault}/drafts/` with frontmatter (tool, target, url, context, generated timestamp)
2. Body is the draft comment text, ready to copy-paste
3. Record the file link in the Staged Drafts table

### Draft quality guidelines

- **Ready to paste** with minimal edits — not a summary, an actual reply
- Professional tone matching the user's style
- Never fabricate technical facts or decisions
- If insufficient context: "Thanks — I'll look into this and get back to you shortly."
- Do NOT draft for: FYI messages, announcements, ambiguous contexts

### Update daily note with draft results

After all drafts are staged, update the `<!-- AGENT:action_items -->` section. Each action item that has a draft should include the draft link inline:

- `→ [Draft ready to review](channel_link)` for Slack (native draft link)
- `→ [[YYYY-MM-DD-jira-KEY-comment]]` for JIRA/GitHub issues (Obsidian wikilink)
- `→ [Pending review staged](pr-url)` for GitHub PRs

Items without drafts (FYI, read-only) get no draft link.

## Step 5 — Save state and cache results

### Save state
Write: `~/.claude/skills/morning-assistant/state/last-run.json`

Include a `github_reviews_staged` array with per-PR details so the discard script (`discard-github-review.js --all`) can find them:

```json
{
  "timestamp": "...",
  "github_reviews_staged": [
    { "owner": "adobe", "repo": "spacecat-api-service", "number": 2007, "instance": "github.com", "reviewId": 12345 },
    { "owner": "CQ", "repo": "personalization", "number": 416, "instance": "corporate", "reviewId": 67890 }
  ],
  "drafts_staged": { "slack": 1, "jira": 0, "github_review": 2, "github_issue": 0, "confluence": 0 },
  ...
}
```

### Cache brief results

Write gathered data to: `~/.claude/skills/morning-assistant/state/brief-cache.json`

```json
{
  "timestamp": "2026-03-23T08:00:00Z",
  "lookbackHours": 24,
  "results": {
    "slack": { ... },
    "jira": { ... },
    "github_com": { ... },
    "github_corp": { ... },
    "confluence": { ... },
    "ai_radar": { ... }
  }
}
```

This cache is used by Deep Dive mode to avoid re-fetching when a Deep Dive runs within 1 hour of a brief. The cache is best-effort — if missing or stale, Deep Dive fetches fresh data.

### Report to user

Tell the user:
- Action items found (count)
- Drafts staged (count, per tool)
- Tools skipped and why
- Stale config warnings (if any)
- Duration
- Full path to the daily note

---

# Deep Dive Mode

Route the user's question to the appropriate tool sub-agents.

## Check brief cache first

Before fetching, check `~/.claude/skills/morning-assistant/state/brief-cache.json`. If it exists and `timestamp` is less than 1 hour old, use the cached results for any tools that overlap with the query — skip re-fetching those tools. This makes Deep Dive nearly instant right after a morning brief.

If the cache is stale or missing, fetch fresh data as normal.

## Detect target tools

| Keywords / signals | Route to |
|---|---|
| Slack, channel, DM, thread, message | `morning-slack` |
| Email, Outlook, inbox, Teams, meeting | `morning-outlook` |
| JIRA, ticket, issue, ENG-, PLAT-, story | `morning-jira` |
| Confluence, wiki, page, doc, runbook | `morning-confluence` |
| GitHub, PR, pull request, review, repo, CI | `morning-github` |
| Cross-tool / project name / person name | All relevant tools in parallel |
| Unclear | Ask the user which tool(s) |

## Extract time range

If specified ("this week", "last 3 days", "since Monday"), use that.
Default: `deep_dive_default_days` from config (default: 7 days).

## Spawn sub-agents

For each target tool, spawn a sub-agent in search mode:

**gather_method = script**: Run `node {scripts_path}/fetch-{tool}.js --search "query terms"`
**gather_method = connector**: Use connector with search/query capability
**gather_method = browser**: Browse to the tool's search UI

## Synthesize and present

Build a cross-tool timeline or topic-based summary. **Deduplicate across tools** using these identity keys:

| Match type | Identity key | Example |
|---|---|---|
| JIRA ticket | Ticket key (e.g. `SITES-1234`) | Same ticket in JIRA results and mentioned in Slack/GitHub |
| GitHub PR/Issue | `owner/repo#number` | Same PR in GitHub notifications and referenced in JIRA/Slack |
| Confluence page | Page ID or title | Same page in Confluence results and linked in Slack |

When the same item appears in multiple tools, **merge into one entry** with combined context from all sources. Show the primary tool's details and note which other tools also referenced it:

```
- **SITES-1234: Auth migration** (JIRA + Slack + GitHub)
  - JIRA: In Progress, assigned to Alice, 3 comments (latest: yesterday)
  - Slack: Discussed in #backend-team (2 threads, 5h ago)
  - GitHub: PR #91 open, CI passing
```

Highlight:
- Key decisions made
- Open items needing the user's input
- Who said/did what and when

Present conversationally in Cowork. No daily note written unless the user asks to save it.

## Optional draft staging

After presenting results, ask:
> "Want me to draft responses for any of these?"

If yes, use the tool-appropriate draft method (see Step 4 in Morning Brief Mode):
- Slack → native draft via the `morning-slack` sub-agent (`slack_send_message_draft`)
- JIRA / GitHub Issues → local MD fragment in vault
- GitHub PRs → pending review via API
- Outlook → Claude in Chrome (when available)

---

## Critical safety constraints — ENFORCE WITHOUT EXCEPTION

1. **Never click Send, Post, Submit** or any send-equivalent
2. **Never permanently delete emails** — archive only
3. **Never edit Confluence pages** — read-only
4. **Never merge PRs** — read-only on GitHub
5. **Never change JIRA ticket status** — comment drafts only
6. **Stop gracefully on unexpected state** — login prompt, CAPTCHA, error page → log it, skip tool, continue
