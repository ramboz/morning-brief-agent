---
status: REVIEWED
dependencies: []
last_verified: 2026-06-18
---

## Slice 008-01 - adr-filename-index-normalization

**Goal:** Bring existing ADR files and the decisions README into jig's canonical
`adr-NNNN-<slug>.md` shape.

**DoR:**
- [x] Existing ADR-001 and ADR-002 contents are reviewed for accepted status.
      Both are `**Status:** Accepted` (2026-03-19, 2026-03-23); ADR-002's Slack
      row is partially superseded by ADR-0005.
- [x] Any helper limitations around `rename-decisions` are understood.
      `migrate.py rename-decisions` only performs the `docs/adrs/ →
      docs/decisions/` move and reports "already aligned" here; it does not
      renumber `ADR-00N-*.md` files already living in `docs/decisions/`, so the
      rename is a manual `git mv` + link sweep.

**Acceptance Criteria:**

1. **Existing ADR filenames are canonical.** Legacy `ADR-001...` and
   `ADR-002...` files are renamed to `adr-0001...` and `adr-0002...`.
2. **Links are updated.** Docs referencing the old filenames point at the new
   files.
3. **The index is useful.** `docs/decisions/README.md` lists accepted and
   proposed ADRs with readable summaries.

**DoD:**
- [x] `adr.py index docs/decisions` or an equivalent manual index check has
      been run. `adr.py index` cannot parse the legacy `**Status:**` prose
      format without a structural rewrite the DoD forbids, so the equivalent
      manual index check was used: every index link was verified to resolve to
      a real `adr-NNNN-*.md` file.
- [x] No accepted ADR prose is changed except filename/link normalization.
      Both ADR bodies are byte-for-byte unchanged (only the files were renamed);
      no headings, status lines, or content were edited.

**Anti-horizontal-phasing check:** Future decision work starts from a clean ADR
index instead of requiring every author to remember legacy naming exceptions.

### Deviation log (after reconciliation)

_Not started._

