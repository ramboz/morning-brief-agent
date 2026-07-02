---
status: RECONCILED
dependencies: []
last_verified: 2026-07-02
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

### Deviation log

- **Manual index check instead of `adr.py index`.** The DoD offered
  "`adr.py index` **or an equivalent manual index check**." `adr.py index`
  cannot parse the two legacy ADRs: `_extract_title` requires a 4-digit
  `# ADR-NNNN:` heading and `_extract_status_and_date` requires a `## Status`
  section, but the legacy ADRs use `# ADR-001:` / `**Status:** Accepted` prose.
  Reformatting them to satisfy the parser would violate the DoD's "no accepted
  ADR prose changed" constraint, so the equivalent manual check (every
  `docs/decisions/README.md` index link resolves to a real `adr-NNNN-*.md`
  file) was used, and the index for these two entries is hand-maintained. A
  README note (lines under `## Index`) documents this openly.
- **Filenames canonicalized; ADR bodies left byte-for-byte unchanged.** Both
  ADRs were `git mv`-renamed at 100% similarity; their `# ADR-001` / `# ADR-002`
  three-digit headings and `**Status:**` prose are intentionally retained as
  accepted pre-jig history. This deliberately leaves a cosmetic filename
  (`adr-0001`) vs. heading (`ADR-001`) digit difference — documented in the
  README note. Scope note (per compliance review): "byte-for-byte unchanged" is
  scoped to what *this* slice touched; ADR-0002's body already carried the
  ADR-0005 Slack-supersession line from prior spec-004 work.
- **AC2 link sweep widened beyond docs after review.** The initial sweep only
  covered `*.md`. Both reviewers flagged four live helper scripts
  (`scripts/{cleanup-drafts,build-draft-index,stage-local-draft,discard-github-review}.js`)
  whose `Reference:` header comments still named the old filename — fixed. This
  resolves the follow-up 005-03 explicitly deferred ("`discard-github-review.js`
  still cites ADR-002 in its header … tidy on a future pass"); recorded as a
  dated amendment on that closed slice.
- **Mid-slice integration of `origin/main` (spec 007 + ADR-0004 acceptance).**
  The base was 5 commits behind. Rebased onto `origin/main`, resolving two
  SKILL.md conflicts: `morning-confluence` took origin's read-only MCP rewrite
  (which had already removed the ADR-002 draft section — nothing to fix there);
  `morning-jira` kept origin's richer `[ADR-002](…)` link + MCP-migration note
  but with the filename corrected to `adr-0002-…`. Integration also surfaced a
  broken `docs/architecture.md:132` link (from origin/main), fixed as part of
  the AC2 sweep. The README ADR-0004 entry now reflects origin's
  `Accepted 2026-07-02 — realized by spec 007`.

### Reconciliation sweep

- **`docs/decisions/README.md` index** — *updated*: folded ADR-0001/0002 into
  the numeric `## Index`, added the pre-jig note, and merged origin/main's
  ADR-0004 acceptance line. All 8 links resolve.
- **Live-prose ADR filename references (docs + skills + scripts + architecture)**
  — *updated*: full repo sweep (all file types) is clean; no live reference
  points at the old `ADR-00N-<slug>.md` filenames.
- **Closed-spec records (`docs/specs/004-*`, `docs/specs/005-*`)** — *no-op*:
  immutable history per ADR-0010; they still name the old path in frozen prose
  and are intentionally left. The one tracked *follow-up* in 005-03 is closed
  via a dated amendment (see above).
- **ADR body prose** — *no-op*: unchanged per DoD (verified 100%-similarity
  renames).
- **`docs/architecture.md` Contract surfaces** — *deferred*: out of scope for
  008-01; it is slice 008-02's subject.
- **Craft nit — index summaries for ADR-0003/0004/0006/0007/0008 quote the
  Context problem-statement rather than the decision** — *deferred*: these are
  pre-existing entries carried forward; normalizing to decision-first is a
  future docs pass, out of this rename slice's scope.
- **Test suite** — *no-op (verified green)*: `npm test` 47/47 on Node 20 after
  integration; this slice adds no code paths.
- **`docs/decisions/lightweight-decisions.md`** — *no-op*: file absent; the
  keep-heading / manual-index decision is captured in this deviation log and the
  README note rather than minting a new tracking file for one entry.

