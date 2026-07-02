---
status: DONE
dependencies: []
last_verified: 2026-07-02
---

## Slice 008-03 - legacy-cowork-doc-triage

**Goal:** Decide what to keep, port, or retire from legacy Cowork-era docs and
skills as Codex/jig specs become the active source of truth.

**DoR:**
- [x] `CLAUDE.md`, `README.md`, `docs/morning-assistant-v2-vision.md`, and
      `skills/**` have been inventoried. Also inventoried: root `specs/` (v1 API
      reference) and `brief.md` (jig scaffold report). Findings recorded in the
      disposition table (see DoD).

**Acceptance Criteria:**

1. **Each legacy surface has a disposition.** Keep as reference, port into jig
   docs, supersede with a spec, or remove later.
2. **Contradictions are reduced.** Current docs no longer tell future agents to
   prefer obsolete Cowork/browser paths where MCP/plugin paths are primary.
3. **Reference value is preserved.** Useful old specs and prompts remain linked
   until a new spec explicitly supersedes them.

**DoD:**
- [x] `AGENTS.md`, `docs/product-vision.md`, and `docs/architecture.md` reflect
      the final disposition. `architecture.md` gained a `## Legacy documentation`
      section (the canonical disposition table); `AGENTS.md` Key Documents gained
      a "Legacy docs" pointer; `product-vision.md`'s open question on legacy
      Cowork skills is struck through and resolved with a pointer to it.
- [x] Any removals are done in a separate reviewed slice, not casually bundled.
      This slice deletes nothing — it records dispositions and adds redirect
      banners to `CLAUDE.md`, `README.md`, and the vision doc. Removals/ports are
      explicitly deferred.

**Anti-horizontal-phasing check:** Future work starts from one coherent project
story instead of reconciling multiple stale architecture narratives.

### Deviation log

- **Disposition recorded in `architecture.md`, not a new file.** Chose to put the
  canonical disposition table in a new `## Legacy documentation` section of
  `docs/architecture.md` (rather than a standalone `docs/legacy-docs.md`) so the
  DoD's three "reflect the disposition" docs converge on one authoritative place,
  with `AGENTS.md` + `product-vision.md` pointing at it.
- **Contradiction reduction is banner-only; bodies preserved.** `CLAUDE.md`,
  `README.md`, and `docs/morning-assistant-v2-vision.md` each got a top redirect
  banner; their Cowork-era bodies (three-layer browser-first framing, Phase 0–8
  roadmap, DM-to-self references) are intentionally left intact as reference. This
  honors the DoD's "removals in a separate reviewed slice" — nothing was deleted.
- **`README.md:42` is pre-existing, not an edit (compliance false-positive
  cleared).** The compliance reviewer flagged the Layer-1 line "Codex/jig workflow
  plus brief shell" as a possible in-body correction. `git diff` confirms this
  slice's README change is banner-only; that line predates spec 008. No deviation.
- **Post-review consistency fix (nit).** The compliance reviewer noted
  `product-vision.md` § Stack still listed "which legacy Cowork skills remain
  useful" as Open while § Open questions marked it resolved. Annotated the § Stack
  line so the two sections agree (still additive, no removal).
- **Craft wording-drift nit accepted.** The CLAUDE.md banner says "three-layer
  browser-first data gathering model" while the disposition-table row says
  "browser-first gather" — both accurate, not a contradiction; left as-is.

### Reconciliation sweep

- **`docs/architecture.md`** — *added*: `## Legacy documentation` disposition
  table + updated the § Open questions "legacy Cowork material" clause to point at
  it.
- **`CLAUDE.md` / `README.md` / `docs/morning-assistant-v2-vision.md`** —
  *updated*: top redirect banners only; bodies unchanged (removals deferred).
- **`AGENTS.md`** — *updated*: Key Documents gained a "Legacy docs" pointer.
- **`docs/product-vision.md`** — *updated*: § Open questions legacy-skills entry
  struck through + resolved; § Stack "Open" clause reconciled to match.
- **Removals / ports of legacy content** — *deferred*: explicitly out of scope per
  DoD; trigger is a future dedicated port/removal slice.
- **Primer hygiene (spec 008 closes with this slice)** — *no-op*: `CLAUDE.md` and
  `AGENTS.md` carry no in-flight spec-008 section to compress; the durable
  disposition lives in `architecture.md` and the status board tracks slice state.
  The CLAUDE.md banner is a standing disposition, not transient in-flight work.
- **Memory-sync** — *updated*: two net-new gotchas appended to
  `docs/memory/learnings.md` — the legacy-ADR `adr.py index` constraint (008-01)
  and the envelope `mode` open-vocabulary discovery (008-02). The config-as-contract
  decision and the legacy-docs disposition are recorded in-repo
  (`docs/contracts/README.md` and `architecture.md` § Legacy documentation), not
  duplicated in learnings.md.
- **Status board (`docs/specs/README.md`)** — *deferred to DONE*: currently shows
  008-03 pre-DONE; regenerated via `workflow.py status-board` immediately after the
  DONE transition (per the recurring-drift learning at learnings.md:85 — verified,
  not a "later" promise).
- **Closed-spec drift / ADR / conventions** — *no-op*: this slice touches only live
  docs; no closed record edited (008-01 handled the 005 amendment), no new
  decision-with-rejected-alternatives beyond the disposition recorded in
  `architecture.md`.

