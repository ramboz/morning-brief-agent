---
status: DRAFT
dependencies: []
last_verified: 2026-06-18
---

## Slice 002-01 - scope-and-source-trim

**Goal:** Align AI Radar's source config and fetch support with the revived
v1 scope: small curated sources, no broad catalog, no Hugging Face papers,
no newsletter/manual ingestion, and no trend engine.

**DoR:**
- [ ] Current `config/ai-radar.example.json` has been reviewed against
      `AGENTS.md` non-goals.
- [ ] Any source type kept in v1 has a clear user-facing purpose in the daily
      digest.

**Acceptance Criteria:**

1. **The example config is v1-small.** Enabled default sources are limited to
   a small curated list that directly supports AI tooling, agents, MCP, Codex,
   Claude, or this project.
2. **Non-goal source types are disabled or removed from v1 flow.** Hugging Face
   papers, newsletters/manual ingestion, broad social feeds, and trend-engine
   behavior are not enabled by default.
3. **The fetcher degrades clearly.** Unsupported or deferred source types do
   not break the whole run; skipped/deferred sources are documented in config
   notes or warnings.

**DoD:**
- [ ] `node scripts/fetch-ai-radar.js --brief --no-dedupe` completes with the
      trimmed config.
- [ ] The changed source list is documented in the spec close-out.
- [ ] No unrelated source-area scripts are modified.

**Anti-horizontal-phasing check:** A user running AI Radar after this slice gets
a smaller, more relevant digest instead of a broad feed cleanup with no visible
daily value.

### Deviation log (after reconciliation)

_Not started._

