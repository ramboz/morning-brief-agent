---
status: DRAFT
dependencies: ["003-01"]
last_verified: 2026-06-18
---

## Slice 003-03 - failure-reporting-state

**Goal:** Add minimal per-source run metadata so failed sources do not block
the brief and repeated failures are visible.

**DoR:**
- [ ] The manual brief shell has at least one real source section.
- [ ] The current script envelope fields are documented.

**Acceptance Criteria:**

1. **Each source fails independently.** One failed source produces a warning
   section or footer note without preventing other sections from rendering.
2. **Last-run metadata is persisted.** The shell records enough local state to
   show last success/failure time per source.
3. **State remains inspectable.** The state file is plain JSON and ignored if it
   contains local run data.

**DoD:**
- [ ] Failure behavior is exercised with a simulated source failure.
- [ ] Any new state path is added to `.gitignore` if appropriate.

**Anti-horizontal-phasing check:** The daily note becomes more trustworthy
because it says what ran, what failed, and what still produced value.

### Deviation log (after reconciliation)

_Not started._

