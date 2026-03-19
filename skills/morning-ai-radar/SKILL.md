---
name: morning-ai-radar
description: AI news and tooling radar — fetches a small curated source set, triages with Claude, injects an AI Radar section into the daily note. Read-only, no draft staging.
allowed-tools: bash
---

# Morning AI Radar

Fetch curated AI/agent ecosystem content from a small source list. Run a Claude-powered relevance triage with a safe fallback. Inject a structured **AI Radar** section into the daily note.

This is a read-only skill — no browser automation, no draft staging.

## Load config

Read: `~/.claude/skills/morning-ai-radar/config/ai-radar-sources.json`

If missing, stop:
> AI Radar config missing — copy ai-radar-sources.example.json and fill in your settings.

If `enabled: false`, skip silently.

---

## Step 1 — GATHER (fast)

Invoke the helper script:

```bash
node {scripts_path}/fetch-ai-radar.js --brief
```

The script handles all data fetching:
- RSS/Atom feeds via rss-parser
- GitHub releases via API
- Optional GitHub trending via HTML scraping
- Deduplication against the rolling cache

It returns structured JSON with triaged items classified into layers:
- `today_signal` — breaking releases, new tools, API changes (< 48h old)
- `skills_tutorials` — tutorials, cookbooks, tools you can use this week
- `strategic_radar` — trend-level shifts (weekly digest, Mondays only)

## Step 2 — ANALYZE

Parse the script output. If `ok: false`, report the errors and skip the section.

For each surviving item:
- Items with `build_relevance` set get a 📌 flag
- `today_signal` and `skills_tutorials` render daily
- `strategic_radar` renders only on Mondays as "On Your Radar"

## Step 3 — Format daily note section

```markdown
## 🤖 AI Radar

### What Should I Do?
- Evaluate the MCP release notes for changes that matter to your architecture.
- Save the most relevant tutorial or post for this week's implementation time.

### Today's Signal
- 📌 **Anthropic releases Claude 4 with extended thinking** — Directly relevant: evaluate for summarization upgrade.
  [→ Read](https://anthropic.com/...)
- **MCP Specification v1.3 released** — New streamable_http transport.
  [→ Read](https://github.com/...)

### Skills & Tutorials
- 📌 **Building a multi-agent Morning Brief with Cowork** — Matches your exact architecture.
  [→ Read](https://...)
- **Hamel Husain: Evaluating LLM agents in production** — Practical evals framework.
  [→ Read](https://hamel.dev/...)

### On Your Radar *(Mondays only)*
- **Shift toward model-native tool calling** — Growing trend away from framework abstractions.
- **MCP server ecosystem maturing fast** — 40+ official connectors now available.

---
*Sources: 5 checked · 14 items fetched · 6 after triage · Last run: 06:00*
```

If zero items after triage: `_Nothing significant today._`

Omit the "On Your Radar" section entirely on non-Monday days.

## Output

Return to the orchestrator:
- The formatted daily note section (markdown)
- Stats: feeds checked, items fetched, items after triage
- No draft targets (read-only skill)

---

## Error handling

| Scenario | Action |
|---|---|
| Config missing | Stop, report "AI Radar config missing" |
| `enabled: false` | Skip silently — no section in daily note |
| Script fails to run | Report error, skip section |
| Script returns `ok: false` | Report errors from script, skip section |
| Zero items after triage | Render section with "Nothing significant today." |

## Scheduling

The AI Radar fetch ideally runs **nightly** (separate from the morning brief) so triage is complete before the brief assembles. Configure via Cowork scheduled task at `fetch_hour_utc` from config (default: 04:00 UTC).

If no scheduled task exists, the script runs inline during the morning brief (adds ~10-15 seconds).
