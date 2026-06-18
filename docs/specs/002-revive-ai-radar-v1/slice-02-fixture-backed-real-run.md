---
status: DONE
dependencies: ["002-01"]
last_verified: 2026-06-18
---

## Slice 002-02 - fixture-backed-real-run

**Goal:** Save a reproducible fixture from a real AI Radar run using the
trimmed source list.

**DoR:**
- [x] Slice 002-01 has defined the v1 source set.
- [x] Required tokens or unauthenticated source paths are available locally.

**Acceptance Criteria:**

1. **A real run produces structured output.** The script returns the standard
   envelope with stats, grouped items, actions, warnings, and Markdown.
2. **Fixtures are refreshed from the real run.** `tests/fixtures/ai-radar.json`
   and `tests/fixtures/ai-radar.md` reflect the current v1 behavior.
3. **The fixture is useful for review.** The Markdown includes source stats and
   enough item context to judge whether the daily read is valuable.

**DoD:**
- [x] `node scripts/fetch-ai-radar.js --brief --save-fixture` has been run.
- [x] Fixture diffs have been reviewed for accidental noise or sensitive data.
- [x] Any network or source failures are captured as warnings rather than
      crashing the whole slice.

**Anti-horizontal-phasing check:** A reviewer can open the fixture Markdown and
judge the revived AI Radar experience without reading implementation code.

### Implementation close-out

The real-run fixture was refreshed with:

```bash
node scripts/fetch-ai-radar.js --brief --save-fixture
```

Result: completed successfully with 5 checked sources, 5 deferred sources, 2
items fetched, and 1 item after heuristic triage. Claude triage was unavailable
locally because `ANTHROPIC_API_KEY` was not set, so the safe heuristic fallback
was used.

The saved fixture now normalizes worktree-specific output paths to repo-relative
paths and stabilizes fixture-only run timestamps. Runtime CLI output still
contains the real absolute output paths and actual run time.

No source fetch failed. Deferred v1 sources and the missing Claude token are
captured as warnings in `tests/fixtures/ai-radar.json`.

### Deviation log (after reconciliation)

Reviewer verdicts:

- Compliance pass: pass.
- Craft pass: pass.

No source-scope deviations were introduced. The slice still produces a fixture
from a real AI Radar run using the trimmed v1 source list.

Accepted reconciliation notes:

- The saved fixture normalizes worktree-specific output paths and fixture-only
  run times while preserving real absolute paths and actual run time in normal
  CLI output.
- The captured run used `heuristic_fallback` because `ANTHROPIC_API_KEY` was not
  set locally. This is accepted because the slice explicitly requires source and
  network failures to degrade as warnings instead of blocking the real-run
  fixture.
- Fixture dates still derive from the real run date, so a future rerun on a
  different day can update dated output paths and `publishedAt` values. This is
  accepted for v1 because the fixture is meant to be refreshed from real runs,
  not frozen as a synthetic golden file.
- Keep the fixture-only normalization and explicit warning capture patterns for
  future source slices.
