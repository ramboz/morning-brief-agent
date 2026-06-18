# Spec 09 — AI Radar

## Overview

The AI Radar is a nightly data-gathering module that fetches curated content from a
small configurable list of RSS feeds, GitHub releases, and curated HTML page watches, runs a Claude-powered relevance
and triage pass, and injects a structured **AI Radar** section into the Obsidian daily
note alongside the work signals.

The goal is not raw news aggregation — it is **actionable signal for a frontier
engineer building agent systems**. Build v1 intentionally narrow: small source list,
explicit action layer, fixture-backed reproducibility, and graceful fallback behavior.

Every item surfaces in one of three layers:

| Layer | Cadence | Purpose |
|---|---|---|
| **Today's Signal** | Daily | Breaking releases, new tools, API changes |
| **Skills & Tutorials** | Daily (filtered) | Things you can build or use this week |
| **Strategic Radar** | Weekly digest, surfaced on Mondays | Trend-level shifts worth tracking |

---

## Module Location

```
scripts/fetch-ai-radar.js
```

Follows the same standalone-runner + fixture pattern as the other helper scripts.

---

## Data Sources

Defined in `config/ai-radar.json` (actual config gitignored). See the committed
example at `config/ai-radar.example.json`.

### Source Categories

#### Curated v1 sources
Fast-moving sources are checked daily. Keep this list intentionally small for v1.

| Source | Feed URL | Type |
|---|---|---|
| Simon Willison's Blog | `https://simonwillison.net/atom/everything` | Atom |
| MCP Spec Releases | GitHub API — `modelcontextprotocol/specification` | GitHub Releases |
| MCP Servers Releases | GitHub API — `modelcontextprotocol/servers` | GitHub Releases |
| Anthropic Cookbook | GitHub API — `anthropics/anthropic-cookbook` commits | GitHub Commits |
| Claude Code Skills Docs | `https://docs.claude.com/en/docs/claude-code/skills` | HTML Page Watch |
| Claude Code MCP Docs | `https://docs.anthropic.com/en/docs/claude-code/mcp` | HTML Page Watch |
| OpenAI Harness Engineering | `https://openai.com/index/harness-engineering/` | HTML Page Watch |

#### GitHub Trending
Optional for v1. Fetched via the unofficial GitHub trending endpoint (no auth required).
Filter to topics: `llm`, `agents`, `mcp`, `claude`, `openai`, `rag`, `langchain`.

```
https://github.com/trending/javascript?since=daily
https://github.com/trending/python?since=daily
```

Parsed via `cheerio` (HTML scraping) — the GitHub trending page has no official API.

Keep newsletters and manual-entry sources out of the first slice.

---

## Configuration

### `config/ai-radar.example.json`

```json
{
  "enabled": true,
  "fetch_hour_utc": 4,
  "dedup_window_days": 7,
  "max_items_per_layer": {
    "today_signal": 5,
    "skills_tutorials": 5,
    "strategic_radar": 3
  },
  "relevance_context": "Building a personal Morning Briefing Agent using Node.js, Claude API, Cowork, and MCP servers. Integrations include JIRA DC, Confluence DC, GitHub (two instances), Slack, and Microsoft 365. Goal: automated agent crews handling grunt work while I orchestrate and review.",
  "project_keywords": [
    "mcp", "model context protocol", "claude", "anthropic", "agent", "cowork",
    "langchain", "automation", "obsidian", "node.js", "workflow", "orchestration"
  ],
  "sources": [
    { "id": "simon-willison", "label": "Simon Willison", "url": "https://simonwillison.net/atom/everything", "type": "atom", "category": "practitioner", "enabled": true },
    { "id": "mcp-spec-releases", "label": "MCP Spec Releases", "url": "https://api.github.com/repos/modelcontextprotocol/specification/releases", "type": "github_releases", "category": "tooling", "enabled": true },
    { "id": "mcp-servers-releases", "label": "MCP Servers Releases", "url": "https://api.github.com/repos/modelcontextprotocol/servers/releases", "type": "github_releases", "category": "tooling", "enabled": true },
    { "id": "anthropic-cookbook", "label": "Anthropic Cookbook Commits", "url": "https://api.github.com/repos/anthropics/anthropic-cookbook/commits", "type": "github_commits", "category": "skills_tutorials", "enabled": true },
    { "id": "claude-skills-docs", "label": "Claude Code Skills Docs", "url": "https://docs.claude.com/en/docs/claude-code/skills", "type": "html_page", "category": "skills_tutorials", "enabled": true },
    { "id": "claude-code-mcp-docs", "label": "Claude Code MCP Docs", "url": "https://docs.anthropic.com/en/docs/claude-code/mcp", "type": "html_page", "category": "tooling", "enabled": true },
    { "id": "openai-harness-engineering", "label": "OpenAI Harness Engineering", "url": "https://openai.com/index/harness-engineering/", "type": "html_page", "category": "tooling", "enabled": true }
  ]
}
```

### Environment Variables

No new secrets are required for fallback operation. Claude triage uses
`ANTHROPIC_API_KEY` when present; without it, the script falls back to heuristic triage.
GitHub trending is unauthenticated. GitHub releases API calls use `GITHUB_TOKEN`
(already defined for the github source modules).

```
# Optional: set ANTHROPIC_API_KEY to enable Claude triage.
# Optional: set RADAR_FETCH_HOUR_UTC to override config default.
```

---

## Fetch Logic

### RSS / Atom

Use `rss-parser` (npm). No auth required for public feeds.

```js
import Parser from 'rss-parser'
const parser = new Parser()
const feed = await parser.parseURL(source.url)
// feed.items → [{ title, link, pubDate, contentSnippet, ... }]
```

Filter to items published within the last `lookback_hours` (default: 24h for daily
layers, 7 days for strategic radar).

### GitHub Releases API

```
GET https://api.github.com/repos/{owner}/{repo}/releases
Authorization: Bearer {GITHUB_TOKEN}
```

Extract: `tag_name`, `name`, `body` (first 300 chars), `published_at`, `html_url`.

### GitHub Trending

Use `cheerio` to parse the HTML trending page. Extract per-repo:
- repo name + owner
- description
- language
- stars today
- link

Filter by topic keywords defined in `project_keywords` config. Keep top 5 matches.

### HTML Page Watch

Use `type: "html_page"` for curated docs or blog pages that do not provide a usable feed.

The fetcher:
- downloads the page HTML,
- extracts title, summary, and watched body text,
- computes a content hash,
- emits an item only when the watched content changes.

This makes official docs and product pages viable radar sources without RSS.

## Relevance Scoring

After fetch, all raw items are passed to Claude in a single batch call for triage.

### Prompt Pattern

```
System:
You are a relevance triage engine for a frontier engineer building AI agent systems.
The engineer's current focus: {config.relevance_context}
Project keywords: {config.project_keywords.join(', ')}

You will receive a list of news items. For each item, return a JSON array with:
- id: the item's id
- layer: one of "today_signal" | "skills_tutorials" | "strategic_radar" | "skip"
- score: 0–10 relevance score
- reason: one sentence explaining the classification
- build_relevance: optional — if directly relevant to the engineer's current project,
  a one-sentence note explaining the connection. Omit if not relevant.

Scoring guidance:
- today_signal: breaking model releases, new API capabilities, major tool launches,
  MCP updates. Must be < 48h old.
- skills_tutorials: tutorials, cookbook patterns, walkthrough posts, new open-source
  tools the engineer could use this week.
- strategic_radar: trend analysis, architecture patterns, research with medium-term
  implications. Eligible for weekly digest only.
- skip: noise, marketing fluff, unrelated domains, duplicates.

Return ONLY valid JSON. No preamble.

User:
{JSON.stringify(items)}
```

The Claude API call uses the configured model or a sensible default, with
`max_tokens: 2000`.

### Post-Triage

- Items scored `skip` are dropped.
- Remaining items are sorted by score descending within each layer.
- Each layer is capped at `max_items_per_layer` from config.
- Items with `build_relevance` set are flagged with a 📌 pin in the daily note.

---

## Deduplication

A rolling dedup cache is maintained at `logs/ai-radar-seen.json`:

```json
{
  "seen": {
    "https://some-article-url": "2026-03-18",
    ...
  }
}
```

Before triage, items whose URL is in the seen cache and whose date is within
`dedup_window_days` are removed. After triage (post-skip), surviving items are added
to the cache. The cache is pruned on each run to remove entries older than
`dedup_window_days`.

---

## Daily Note Output

Anchor comment: `<!-- AGENT:ai-radar -->`

```markdown
## 🤖 AI Radar

### What Should I Do?
- Evaluate the MCP release for architecture-impacting changes.
- Save the most directly relevant tutorial or post for this week's build time.

### Today's Signal
- 📌 **Anthropic releases Claude 4 with extended thinking** — New model with 200k context
  and improved tool use. Directly relevant: evaluate for summarization upgrade in this project.
  [→ Read](https://anthropic.com/...)
- **MCP Specification v1.3 released** — New `streamable_http` transport type added.
  [→ Read](https://github.com/...)
- **LangChain releases LangGraph Cloud** — Managed orchestration for agent graphs.
  [→ Read](https://blog.langchain.dev/...)

### Skills & Tutorials
- 📌 **Building a multi-agent Morning Brief with Cowork** — Step-by-step walkthrough
  matching your exact architecture. [→ Read](https://...)
- **Hamel Husain: Evaluating LLM agents in production** — Practical evals framework
  with fixture-based testing. [→ Read](https://hamel.dev/...)

### On Your Radar *(Mondays only)*
- **Shift toward model-native tool calling** — Growing trend away from framework
  abstractions toward direct API tool use.
- **MCP server ecosystem maturing fast** — 40+ official connectors now available.

---
*Sources: 5 checked · 14 items fetched · 6 after triage · Last run: 06:00*
```

The **On Your Radar** section is only rendered on Mondays (weekly digest cadence). On
other days the section is omitted entirely to keep the daily note lean.

---

## Scheduling

The AI Radar fetch runs **nightly at 04:00 UTC** (configurable via `fetch_hour_utc`),
separate from the morning brief assembly which runs at the user's configured morning
time. This ensures the triage pass is complete before the brief is assembled.

In the v2 Cowork architecture, this maps to two scheduled skills:
- `ai-radar-fetch` — nightly fetch + triage, writes `logs/ai-radar-cache.json`
- `morning-brief` — reads the cache, assembles the daily note

In the v1 CLI fallback, both run sequentially as part of `src/index.js` (the fetch
completes fast enough that sequential is acceptable).

---

## Error Handling

| Scenario | Behaviour |
|---|---|
| `config/ai-radar.json` missing | Return `{ ok: false, error: 'AI Radar config missing' }` |
| `enabled: false` in config | Return `{ ok: true, data: null, skipped: true }` — no section in daily note |
| Individual feed unreachable | Log warning, skip that feed, continue with others |
| Claude triage API call fails | Fall back to scoring all items as `strategic_radar` with score 5, no build_relevance. Log `[ai-radar] triage fallback — Claude API unavailable` |
| GitHub trending parse fails (HTML change) | Log warning, skip trending, continue with RSS feeds |
| Zero items after triage | Render section header with "Nothing significant today." instead of omitting |

---

## Standalone Runner

```bash
node scripts/fetch-ai-radar.js --brief
node scripts/fetch-ai-radar.js --brief --save-fixture
```

---

## Dependencies

```json
{
  "rss-parser": "^3.13.0",
  "cheerio": "^1.0.0"
}
```

Both are lightweight. `cheerio` is already likely present if any other module does
HTML parsing. `rss-parser` is new.

---

## Notes for Implementation

- Run all feed fetches in parallel via `Promise.allSettled` — same pattern as other
  source modules.
- The Claude triage call is a **single batch call** over all items, not one call per
  item. Keep the item list to a max of 60 items before triage to stay within token
  budget. If more items are fetched, pre-filter by recency (keep newest).
- Strip HTML from RSS `contentSnippet` before passing to Claude triage — most feeds
  include markup in descriptions.
- `rss-parser` handles both RSS and Atom formats transparently. Set `type: "atom"` in
  config for human readability only — the parser doesn't need it.
- GitHub trending scraping is fragile by nature. Wrap in a try/catch and treat as
  best-effort. If it breaks, it breaks silently and the other feeds still work.
- The `relevance_context` field in config is the most important tuning lever. Keep it
  updated as your project evolves — it directly controls what Claude considers relevant.
