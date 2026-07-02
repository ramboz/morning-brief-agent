---
name: morning-ai-radar
description: AI news and tooling radar — a helper script fetches curated RSS/GitHub/HTML content; the running agent triages it on the user's Claude subscription and injects an AI Radar section into the daily note. Read-only, no draft staging.
allowed-tools: bash
---

# Morning AI Radar

Fetch curated AI/agent ecosystem content from a small RSS/Atom, GitHub release/commit, and HTML page watch list, then run a relevance triage and inject a structured **AI Radar** section into the daily note.

This is a read-only skill — no browser automation, no draft staging.

**Triage runs on YOUR Claude subscription.** The helper script only *gathers* raw items (Layer 2). You (the running agent) do the relevance reasoning (Layer 1). Do **not** call `api.anthropic.com` / set `ANTHROPIC_API_KEY` to triage — that would double-bill the user. (The script has a keyword-only heuristic fallback for standalone/unattended CLI runs; ignore it when you are running this skill.)

## Load config

Read: `{scripts_path}/../config/ai-radar.json`

If missing, stop:
> AI Radar config missing — copy ai-radar.example.json and fill in your settings.

If `enabled: false`, skip silently.

Extract the triage criteria for Step 2:
- `relevance_context` — one-line description of what the user cares about right now
- `project_keywords` — terms that signal direct build relevance (📌)
- `focus_topics` — broader areas worth tracking

---

## Step 1 — GATHER (fast, script)

Invoke the helper script:

```bash
node {scripts_path}/fetch-ai-radar.js --brief
```

The script handles all data fetching (RSS/Atom via rss-parser, GitHub releases/commits via API, HTML page watches, optional GitHub trending, dedup against the rolling cache).

Parse the JSON envelope. If `ok: false`, report the errors and skip the section. Note `data.warnings` (source fetch errors) — surface a count in the footer, don't fail on them.

**Use `data.raw_items`** — the deduped, normalized items you will triage. Each has: `id`, `title`, `summary`, `url`, `category`, `sourceType`, `sourceLabel`, `changeType`, `publishedAt`.

Ignore `data.items` / `data.markdown` (those are the script's heuristic-only fallback, not for the agent path).

## Step 2 — TRIAGE (you, on the user's Claude subscription)

Classify each item in `raw_items` into exactly one layer. Score relevance against `relevance_context`, `project_keywords`, and `focus_topics` from config. You are triaging for a frontier engineer building AI agent systems.

**Layers:**
- `today_signal` — breaking releases, new tools, API/model changes, or directly impactful updates. Prefer items < 48–72h old.
- `skills_tutorials` — practical workflows, skills, cookbooks, harnessing patterns, docs, or examples worth using this week.
- `strategic_radar` — broader but still-relevant shifts worth tracking (rendered only on Mondays).
- `skip` — generic AI news, broad security/benchmark chatter, funding/hiring/webinar/podcast/conference/meetup noise, or anything not relevant to the focus.

**Rules:**
- Flag items with direct relevance to `project_keywords` with 📌 and a one-line `build_relevance`.
- For docs/official pages, summarize *why the update matters* rather than restating the page title.
- Give each surviving item a concrete `action` only when it deserves a next step (start with Review, Save, Evaluate, or Ignore, and name the item). Otherwise omit.
- Be strict — it's better to `skip` marginal items than to add noise. Aim for signal, not volume.

## Step 3 — Format daily note section

```markdown
## 🤖 AI Radar

### Today's Signal
- 📌 **Anthropic releases Claude with extended thinking** — Directly relevant: evaluate for summarization upgrade.
  [→ Read](https://anthropic.com/...)
- **MCP Specification released** — New streamable_http transport.
  [→ Read](https://github.com/...)

### Skills & Tutorials
- 📌 **Building a multi-agent Morning Brief with Cowork** — Matches your exact architecture.
  [→ Read](https://...)

### On Your Radar *(Mondays only)*
- **Shift toward model-native tool calling** — Growing trend away from framework abstractions.

---
*Sources: {stats.sourcesChecked} feeds checked · {stats.itemsFetched} items fetched · {N} after triage{ · warnings if any} · Last run: {HH:MM}*
```

- Render `today_signal` and `skills_tutorials` daily. Render `strategic_radar` ("On Your Radar") **only on Mondays**; omit the header entirely otherwise.
- Pull the source counts from `data.stats` (`sourcesChecked`, `itemsFetched`). "After triage" is *your* surviving count, not the script's.
- If zero items survive your triage, output the header with `_Nothing significant today._` so the note still shows AI Radar ran.

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
| Many source warnings | Note the count in the footer, still triage what was fetched |
| Zero items after triage | Output the "Nothing significant today." section |

## Scheduling

The AI Radar fetch can run **nightly** (separate from the morning brief) so gathered items are cached before the brief assembles. Configure via a scheduled task at `fetch_hour_utc` from config (default: 04:00 UTC). If no scheduled task exists, the fetch runs inline during the morning brief (adds ~10–15 seconds). Triage always happens inline, when the agent assembles the brief.
