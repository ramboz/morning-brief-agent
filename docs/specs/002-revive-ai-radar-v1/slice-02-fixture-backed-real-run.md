---
status: DRAFT
dependencies: ["002-01"]
last_verified: 2026-06-18
---

## Slice 002-02 - fixture-backed-real-run

**Goal:** Save a reproducible fixture from a real AI Radar run using the
trimmed source list.

**DoR:**
- [ ] Slice 002-01 has defined the v1 source set.
- [ ] Required tokens or unauthenticated source paths are available locally.

**Acceptance Criteria:**

1. **A real run produces structured output.** The script returns the standard
   envelope with stats, grouped items, actions, warnings, and Markdown.
2. **Fixtures are refreshed from the real run.** `tests/fixtures/ai-radar.json`
   and `tests/fixtures/ai-radar.md` reflect the current v1 behavior.
3. **The fixture is useful for review.** The Markdown includes source stats and
   enough item context to judge whether the daily read is valuable.

**DoD:**
- [ ] `node scripts/fetch-ai-radar.js --brief --save-fixture` has been run.
- [ ] Fixture diffs have been reviewed for accidental noise or sensitive data.
- [ ] Any network or source failures are captured as warnings rather than
      crashing the whole slice.

**Anti-horizontal-phasing check:** A reviewer can open the fixture Markdown and
judge the revived AI Radar experience without reading implementation code.

### Deviation log (after reconciliation)

_Not started._

