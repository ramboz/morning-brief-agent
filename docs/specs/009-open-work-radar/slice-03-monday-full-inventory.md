---
status: READY_FOR_IMPLEMENTATION
dependencies: [009-01, 009-02]
last_verified:
---

## Slice 009-03 — monday-full-inventory

**Goal:** On Mondays, expand the daily stale-only alerts into a full open-work
inventory — every open authored PR and in-progress ticket, fresh and stale,
flagged — so the week starts with the complete picture.

**DoR:**
- [ ] 009-01 and 009-02 are DONE (staleness detection + classification exist
      for both sources).

**Acceptance Criteria:**

1. **Monday shows the full inventory.** On Mondays the Open Work section lists
   *all* open authored PRs and *all* in-progress assigned tickets — including
   `fresh` items — not just the stale ones. (Reuses the Monday-detection
   convention already in the brief, e.g. the 72h lookback / ai-radar weekly
   behavior.)
2. **Every item keeps its staleness flag.** Fresh / 🟡 / 🔴 flags render in the
   full list so the stale ones still stand out within the inventory.
3. **Non-Mondays are unchanged.** On any other day the section remains
   stale-only (009-01 / 009-02 behavior); no fresh items leak in.
4. **Grouping is legible.** Items are grouped by source (PRs vs tickets) and
   ordered by staleness (most-stale first), so the inventory reads as a
   prioritised worklist, not a dump.
5. **Empty inventory is handled.** If the user has no open PRs and no
   in-progress tickets at all, the Monday section says so in one line rather
   than rendering empty headers.

**DoD:**
- [ ] All ACs pass; full test suite green on Node 20 (no regressions).
- [ ] Coverage for both branches: a Monday run (full inventory incl. fresh) and
      a non-Monday run (stale-only) over the same fixture data.
- [ ] Reviewed by `reviewer` subagent (compliance + craft).
- [ ] Deviation log produced under this slice heading.
- [ ] Reconciliation sweep produced under this slice heading.

**Anti-horizontal-phasing check:** After this slice, the user's Monday brief is
a single prioritised worklist of everything they have open — the "so I don't
lose track" goal — while weekdays stay lean.

### Deviation log (after reconciliation)

_Not started._
