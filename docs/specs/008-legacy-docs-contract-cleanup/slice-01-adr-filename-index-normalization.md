---
status: DRAFT
dependencies: []
last_verified: 2026-06-18
---

## Slice 008-01 - adr-filename-index-normalization

**Goal:** Bring existing ADR files and the decisions README into jig's canonical
`adr-NNNN-<slug>.md` shape.

**DoR:**
- [ ] Existing ADR-001 and ADR-002 contents are reviewed for accepted status.
- [ ] Any helper limitations around `rename-decisions` are understood.

**Acceptance Criteria:**

1. **Existing ADR filenames are canonical.** Legacy `ADR-001...` and
   `ADR-002...` files are renamed to `adr-0001...` and `adr-0002...`.
2. **Links are updated.** Docs referencing the old filenames point at the new
   files.
3. **The index is useful.** `docs/decisions/README.md` lists accepted and
   proposed ADRs with readable summaries.

**DoD:**
- [ ] `adr.py index docs/decisions` or an equivalent manual index check has
      been run.
- [ ] No accepted ADR prose is changed except filename/link normalization.

**Anti-horizontal-phasing check:** Future decision work starts from a clean ADR
index instead of requiring every author to remember legacy naming exceptions.

### Deviation log (after reconciliation)

_Not started._

