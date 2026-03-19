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

Read: `~/.claude/skills/morning-assistant/config/config.json`

If missing, stop:
> Config not found. Copy `config.example.json` to `config.json` and fill in your settings.

Extract:
- `vault_path`, `daily_notes_folder`, `scripts_path`
- `lookback_hours` (default 24; auto-72h on Mondays)
- `tools` — per-tool config with `enabled`, `gather_method`, `draft_enabled`

Try to load: `~/.claude/skills/morning-assistant/state/last-run.json`

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

Collect results from all sub-agents. Synthesize a ranked Action Items list (max 10):

1. Direct questions / explicit requests mentioning the user
2. Items with deadlines
3. Ongoing discussions where the user is awaited
4. FYI / awareness items

## Step 3 — Write the daily note

Write to: `{vault_path}/{daily_notes_folder}/{YYYY-MM-DD}.md`

```markdown
# Daily Brief — {YYYY-MM-DD}

## ⚡ Action Items
<!-- AGENT:action_items -->
1. 🔴 **Reply to VP Engineering** (Email) — Q2 budget, due Friday → [Draft in Outlook]
2. 🔴 **Review PR #482** (GitHub) — Retry logic → [Draft in GitHub]
<!-- /AGENT:action_items -->

## 📊 Staged Drafts Summary
<!-- AGENT:drafts_summary -->
| # | Tool | Target | Status |
|---|---|---|---|
<!-- /AGENT:drafts_summary -->

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

**Re-run / smart merge:** If the file already exists, replace only content between matching `<!-- AGENT:{key} -->` / `<!-- /AGENT:{key} -->` anchors. Preserve everything else (including user edits).

For skipped tools: `_Skipped — {reason}_`
For empty sections: `_Nothing to report._`

## Step 4 — Stage drafts (Layer 3 — slow, targeted)

For each sub-agent that identified draft targets, use Claude in Chrome to stage drafts in the tool's compose UI. Run sequentially (one tool at a time).

Each sub-agent's SKILL.md defines how to navigate to the target and compose the draft. The orchestrator coordinates the order.

**Only stage drafts for tools where `draft_enabled: true` and `draft_method: "browser"`.**

## Step 5 — Save state and report

Write: `~/.claude/skills/morning-assistant/state/last-run.json`

Tell the user:
- Action items found (count)
- Drafts staged (count, per tool)
- Tools skipped and why
- Duration
- Full path to the daily note

---

# Deep Dive Mode

Route the user's question to the appropriate tool sub-agents.

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

Build a cross-tool timeline or topic-based summary. Deduplicate across tools. Highlight:
- Key decisions made
- Open items needing the user's input
- Who said/did what and when

Present conversationally in Cowork. No daily note written unless the user asks to save it.

## Optional draft staging

After presenting results, ask:
> "Want me to draft responses for any of these?"

If yes, use Claude in Chrome for the specific items.

---

## Critical safety constraints — ENFORCE WITHOUT EXCEPTION

1. **Never click Send, Post, Submit** or any send-equivalent
2. **Never permanently delete emails** — archive only
3. **Never edit Confluence pages** — read-only
4. **Never merge PRs** — read-only on GitHub
5. **Never change JIRA ticket status** — comment drafts only
6. **Stop gracefully on unexpected state** — login prompt, CAPTCHA, error page → log it, skip tool, continue
