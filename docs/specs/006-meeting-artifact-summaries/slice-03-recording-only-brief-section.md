---
status: DRAFT
dependencies: ["006-01"]
last_verified: 2026-06-18
---

## Slice 006-03 - recording-only-brief-section

**Goal:** Render recording-only meetings in the daily brief as manual-watch
items rather than failed summaries.

**DoR:**
- [ ] Slice 006-01 can identify recording-only artifacts.
- [ ] Daily brief shell has a place for meeting sections or source warnings.

**Acceptance Criteria:**

1. **Recording links are surfaced.** The brief includes meeting title, date, and
   watch link when available.
2. **Transcript absence is explicit.** The brief says transcript unavailable
   instead of implying summarization failed.
3. **Action wording is calm.** Recording-only items are not treated as urgent
   unless configured or tied to a direct action.

**DoD:**
- [ ] Fixture or sample brief output includes a recording-only meeting.
- [ ] The section omits itself cleanly when no recording-only artifacts exist.

**Anti-horizontal-phasing check:** The user sees useful meeting follow-up even
when no transcript can be summarized.

### Deviation log (after reconciliation)

_Not started._

