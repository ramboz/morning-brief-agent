---
status: DRAFT
dependencies: ["004-01"]
last_verified: 2026-06-18
---

## Slice 004-03 - fallback-and-coverage-notes

**Goal:** Define when the legacy Slack script remains useful and how coverage
limits appear in the brief.

**DoR:**
- [ ] Plugin coverage has been tested for the first digest/triage scope.
- [ ] Existing `scripts/fetch-slack.js` behavior is understood.

**Acceptance Criteria:**

1. **Fallback is explicit.** The docs say when to use the Slack plugin and when
   to fall back to `scripts/fetch-slack.js`.
2. **Coverage notes are user-facing.** Sparse results, rate limits, or
   connector gaps are rendered in the brief.
3. **No duplicated Slack architecture.** The legacy script is not expanded
   unless a concrete fallback need remains.

**DoD:**
- [ ] `docs/architecture.md` or the Slack spec close-out records the final
      plugin/script boundary.

**Anti-horizontal-phasing check:** The user sees trustworthy Slack output even
when the plugin cannot cover everything.

### Deviation log (after reconciliation)

_Not started._

