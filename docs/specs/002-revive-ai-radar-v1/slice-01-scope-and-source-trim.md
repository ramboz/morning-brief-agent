---
status: DONE
dependencies: []
last_verified: 2026-06-18
---

## Slice 002-01 - scope-and-source-trim

**Goal:** Align AI Radar's source config and fetch support with the revived
v1 scope: small curated sources, no broad catalog, no Hugging Face papers,
no newsletter/manual ingestion, and no trend engine.

**DoR:**
- [x] Current `config/ai-radar.example.json` has been reviewed against
      `AGENTS.md` non-goals.
- [x] Any source type kept in v1 has a clear user-facing purpose in the daily
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
- [x] `node scripts/fetch-ai-radar.js --brief --no-dedupe` completes with the
      trimmed config.
- [x] The changed source list is documented in the spec close-out.
- [x] No unrelated source-area scripts are modified.

**Anti-horizontal-phasing check:** A user running AI Radar after this slice gets
a smaller, more relevant digest instead of a broad feed cleanup with no visible
daily value.

### Implementation close-out

The default AI Radar example config now enables five v1 sources:

- Simon Willison's Weblog, filtered by project-relevant AI/agent keywords.
- MCP Specification Releases.
- MCP Servers Releases.
- Anthropic Cookbook commits, filtered by practical agent/tooling keywords.
- Claude Code Skills Docs.

Deferred source examples remain in the config but are disabled with explicit
`deferred_reason` values: Claude Code MCP Docs, OpenAI Harness Engineering,
GitHub Trending Agents, Hugging Face Papers, and Manual Newsletter Ingestion.
This keeps the v1 boundary visible without enabling broad catalog, manual
newsletter, papers, social-feed, or trend-engine behavior.

The fetcher now returns non-fatal warnings for deferred disabled sources and
tracks `sourcesConfigured`, `sourcesChecked`, and `sourcesSkipped`. The rendered
digest footer includes a deferred-source count.

Verification run:

```bash
node scripts/fetch-ai-radar.js --brief --no-dedupe
```

Result: completed successfully with 5 checked sources, 5 deferred sources, 2
items fetched, and 1 item after heuristic triage. Claude triage was unavailable
locally because `ANTHROPIC_API_KEY` was not set, so the safe heuristic fallback
was used. `jig:tdd-loop` did not detect a project test runner, so the targeted
AI Radar command remains the verification gate for this slice.

### Deviation log (after reconciliation)

Reviewer verdicts:

- Compliance pass: pass.
- Craft pass: pass.

No spec deviations were introduced. Implementation followed the slice's scoped
approach: trim the default source list, keep non-goal examples disabled, and
surface deferred sources as non-fatal warnings.

Accepted reconciliation notes:

- The new deferred-source warning/stats path is verified by the targeted
  `node scripts/fetch-ai-radar.js --brief --no-dedupe` run, not by an
  automated test or refreshed fixture in this slice. That gap is accepted
  because slice 002-02 owns fixture-backed real-run refresh.
- This slice lightly touches existing contract surfaces: AI Radar config
  examples, CLI result stats/warnings, and the Markdown digest footer. Formal
  contract schemas remain deferred to spec 008-02; no ADR was added because the
  source-list trim and warning/footer shape are slice-local and reversible.
- Keep the config-level `deferred_reason` pattern and terse footer count; both
  reviewers called them useful for making v1 scope visible without adding noisy
  digest sections.
