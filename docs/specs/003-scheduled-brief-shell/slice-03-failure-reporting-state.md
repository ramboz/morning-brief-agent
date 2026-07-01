---
status: RECONCILED
dependencies: ["003-01"]
last_verified: 2026-07-01
---

## Slice 003-03 - failure-reporting-state

**Goal:** Add minimal per-source run metadata so failed sources do not block
the brief and repeated failures are visible.

**DoR:**
- [x] The manual brief shell has at least one real source section.
- [x] The current script envelope fields are documented.

**Acceptance Criteria:**

1. **Each source fails independently.** One failed source produces a warning
   section or footer note without preventing other sections from rendering.
2. **Last-run metadata is persisted.** The shell records enough local state to
   show last success/failure time per source.
3. **State remains inspectable.** The state file is plain JSON and ignored if it
   contains local run data.

**DoD:**
- [x] Failure behavior is exercised with a simulated source failure.
- [x] Any new state path is added to `.gitignore` if appropriate.

**Anti-horizontal-phasing check:** The daily note becomes more trustworthy
because it says what ran, what failed, and what still produced value.

### Deviation log (after reconciliation)

- DoR checkboxes were initially left unticked at slice claim despite their
  preconditions already being satisfied (`003-01` shipped a real AI Radar
  source section; envelope fields are documented in `CLAUDE.md`). Ticked
  during the first review round.
- **Blocker found and fixed during review:** the first implementation called
  `loadBriefState`/`updateBriefState` unguarded from `write-brief.js`'s
  `main()`. A corrupt or unwritable `logs/brief-state.json` would throw and
  crash the whole brief run, discarding a fully successful result — directly
  contradicting this slice's own AC1 ("each source fails independently") and
  CLAUDE.md's "every tool fails independently" rule. Fixed by making both
  functions in `scripts/lib/brief/state.js` catch their own read/parse/write
  errors internally (`console.error('[brief]', ...)`) and always return a
  usable state object instead of throwing. Two regression tests were added:
  a unit-level corrupt-file load test, and a full CLI-level test proving the
  brief still completes (`ok:true`, correct markdown) when the state file is
  corrupt.
- `updateBriefState`'s write-failure path (e.g. an unwritable `logs/`
  directory) is covered only by code inspection, not a dedicated regression
  test — only the load-corrupt path has an explicit end-to-end test. Accepted
  given the small size of the guard; noted here rather than left silent.
- `logs/brief-state.json` relies on the pre-existing blanket `logs/`
  gitignore entry rather than a new explicit line — this satisfies the "add
  to `.gitignore` if appropriate" DoD item without adding redundant config.
- `README.md`'s CLI usage section was updated to document the new
  `--state-path` and `--sources` flags this slice introduced.
- Hung-source timeout isolation (the AI Radar subprocess call still has no
  timeout) remains explicitly out of scope per `plan.md` and is carried
  forward in `docs/refinement-todo.md`.
- Reviews: compliance — first round **needs-changes** (minor doc/checklist
  gaps), fixed, second round **pass** (`reviews/slice-03-compliance.md`).
  Craft — first round **needs-changes** (the blocker above), fixed, second
  round **pass** (`reviews/slice-03-craft.md`). No arch or code-health pass —
  the slice frontmatter declares neither, and the change adds no new module
  boundary or public contract beyond the existing brief CLI surface.

### Reconciliation sweep

- `docs/architecture.md` — no-op. No module boundaries or public contracts
  changed; the new state module is internal to the brief writer's CLI.
- ADRs — no-op. The blocker fix is a bug fix (self-guarding I/O), not a
  load-bearing design choice with rejected alternatives.
- `docs/conventions.md` — no-op. The "tools fail independently" rule this
  fix embodies is already stated in CLAUDE.md's "Error Handling — Critical
  Rule"; no new convention needed.
- `docs/inbox.md` — no-op. Empty at reconciliation time; nothing to triage.
- `docs/refinement-todo.md` — updated. Added an interim note under
  "Resolved: Scheduled run mechanism" recording what this slice covered
  (per-source last-run visibility) and what it explicitly left open
  (hung-source timeout isolation).
- Primer hygiene (`CLAUDE.md` / `AGENTS.md` / status board) — checked; no
  in-flight spec-003 prose exists in either primer file to compress. This
  slice closes spec `003` (all three slices DONE/RECONCILED); no further
  primer edits were needed.
- Use-case coverage — n/a; `docs/product-vision.md` has no `## Use cases`
  section in this project.

