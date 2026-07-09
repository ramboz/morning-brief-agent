---
status: DONE
dependencies: [009-01, 009-02]
last_verified: 2026-07-09
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

Original ACs preserved above. Implementation notes:

1. **Day-aware selection + single Open Work entry point.** Since 009-01/009-02's
   runners already return the *full* classified set (fresh + stale), this slice is
   the day-rule + composition, not new fetching. Delivered pure
   `scripts/lib/open-work.js` (`isMondayInventory` + `selectOpenWork` → Monday
   returns everything; other days filter to `staleness !== 'fresh'` with a
   `suppressedFreshCount`; `isEmpty` computed over the *total* set before
   filtering) + a composer `scripts/list-open-work.js` (single `open_work`
   envelope reusing `runOpenPrs`/`extractOpenPrs` + `runInProgress`/`extractInProgress`,
   fault-isolated per source). `skills/morning-assistant/SKILL.md` now calls
   `list-open-work.js` once; weekday = stale-only, Monday = full "Open Work
   Review" (grouped by source, most-stale-first), empty → one-liner. The
   "Monday full inventory deferred" scope note was removed. `list-open-prs.js` /
   `list-inprogress.js` remain valid standalone tools. `npm` script `list:open-work`.

2. **Review nits addressed in reconciliation** (compliance `pass`; craft
   `pass` after a re-review — the first craft pass was `needs-changes` for an
   honesty issue, not a bug):
   - *Docstring honesty* (craft): `list-open-work.js`'s header originally claimed
     the 3rd inline gather-copy was "consistent with the convention"; corrected to
     state the rule-of-three trigger fired and extraction is consciously DEFERRED,
     pointing to the tracked follow-up.
   - *Coverage gap* (craft): added a weekday-all-fresh test (there IS open work but
     none stale → `isEmpty:false`, both shown lists empty, `suppressedFreshCount>0`)
     — the section-suppression case; fixed an inaccurate "same week" test comment.
   - Full suite: **121/121 green on Node 20**.

3. **Beyond the spec's literal flag set:** added a 🟢 emoji for `fresh` items in
   the Monday inventory, extending the spec's 🟡/🔴 traffic-light convention
   (presentational only; the spec table named only 🟡/🔴).

Deferred (non-gating):

- **Extract shared gather glue (rule-of-three FIRED).** `list-open-work.js` is the
  3rd inline copy of the GitHub surface-gather (also `list-open-prs.js`,
  `list-review-requests.js`) and 2nd+ of the JIRA error mapping (also
  `list-inprogress.js`). Extraction deferred here only to avoid modifying the
  already-DONE 009-01/009-02 runners mid-slice. Tracked in
  `docs/refinement-todo.md` (extract `gatherGithubSurfaces()` + `mapJiraError()`,
  fold in 009-01's `loadGithubSection`); *trigger:* next touch to any of those
  runners, or a dedicated refactor slice.
- **Cadence-day timezone:** `isMondayInventory` uses local `getDay()` (reusing the
  ai-radar Monday convention) while JIRA age math uses UTC — could disagree in
  far-western zones (≥ UTC-10) near midnight. Low risk for realistic dev/CI zones.
- **`now` threading:** `list-open-work.js` calls `new Date()` a few times rather
  than threading one injected `now` — harmless (ms apart), marginal cleanliness.

### Reconciliation sweep

| Artifact | Disposition | Rationale |
|----------|-------------|-----------|
| `README.md` | `no-op` | Front door unaffected. |
| `docs/specs/README.md` | `updated` | Regenerated via `workflow.py status-board` to reflect this slice's current status (and spec 009's rollup once it lands DONE). |
| `docs/product-vision.md` | `no-op` | No behavior/scope drift; radar was in scope via spec 009. |
| `docs/architecture.md` | `no-op` | Boundaries already updated in 009-02 (`lib/jira/**`, `lib/github/open-prs.js`); the composer follows the same pattern. |
| `docs/decisions/**` | `no-op` | No ADR — day-rule + composition, no load-bearing decision with rejected alternatives. |
| `docs/contracts/**` | `no-op` | New `open_work` envelope rides the shared `envelope()` producer (schema test unchanged). |
| Primer surfaces: `CLAUDE.md` / `AGENTS.md` | `no-op` | AGENTS.md "Active specs" points to the status board (no per-spec entry to compress); CLAUDE.md has no active-specs section. Spec-025 close-out check performed — nothing to compress. |
| `docs/inbox.md` | `no-op` | Nothing resolved by this slice. |
| `docs/refinement-todo.md` | `updated` | Added the gather-glue rule-of-three deferral with a resolution trigger. |
| `docs/memory/**` | `updated` | Close-out memory-sync: appended the open-work/staleness learning (no lookback bound; surface-don't-hide unknown age; side-effect-free libs for main()-at-load scripts) to `learnings.md`. |
