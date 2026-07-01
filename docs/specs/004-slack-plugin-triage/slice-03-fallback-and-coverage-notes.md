---
status: RECONCILED
dependencies: ["004-01"]
last_verified: 2026-07-01
---

## Slice 004-03 - fallback-and-coverage-notes

**Goal:** Define when the legacy Slack script remains useful and how coverage
limits appear in the brief.

**DoR:**
- [x] Plugin coverage has been tested for the first digest/triage scope. (Slices 004-01/004-02's real sample runs.)
- [x] Existing `scripts/fetch-slack.js` behavior is understood. (Read in full — channel scope matches `sections[].channels`; DM/group-DM fetch is unscoped, reading every DM the token can see via `conversations.list({ types: 'im,mpim' })`.)

**Acceptance Criteria:**

1. **Fallback is explicit.** The docs say when to use the Slack plugin and when
   to fall back to `scripts/fetch-slack.js`.
2. **Coverage notes are user-facing.** Sparse results, rate limits, or
   connector gaps are rendered in the brief.
3. **No duplicated Slack architecture.** The legacy script is not expanded
   unless a concrete fallback need remains.

**DoD:**
- [x] `docs/architecture.md` or the Slack spec close-out records the final
      plugin/script boundary. See "Slack: Plugin-First With Bounded
      Fallbacks" in `docs/architecture.md`.

**Anti-horizontal-phasing check:** The user sees trustworthy Slack output even
when the plugin cannot cover everything.

### Deviation log (after reconciliation)

- **Concrete disposition for both legacy Slack scripts, not just documentation.**
  The slice's Goal frames this as a documentation task ("define when the
  legacy script remains useful"), but implementing it surfaced a real code
  decision: `scripts/stage-slack-draft.js` (the DM-to-self draft mechanism)
  had no remaining fallback need once native drafts (ADR-0005, slice 004-02)
  fully superseded it, so it was deleted rather than merely documented as
  deprecated. `scripts/fetch-slack.js` (the gather fallback) remains — it
  covers a real gap (plugin unavailable) that the DM-to-self script no
  longer does.
- **A genuine behavioral asymmetry in the fallback, not just "less coverage."**
  Read `scripts/fetch-slack.js` in full to satisfy the DoR. Its channel scope
  matches the plugin path's `sections[].channels`, but its DM/group-DM fetch
  (`conversations.list({ types: 'im,mpim' })`) is **not** scoped to
  `sections[].people` — it reads every DM/group-DM the configured token can
  see. This means the fallback path is *broader* than the primary path for
  DMs, not narrower — the opposite of the usual "fallback covers less"
  assumption. Documented explicitly in `docs/architecture.md` and
  `skills/morning-slack/SKILL.md` rather than left as an implicit surprise.
- **Duplicated Slack drafting logic found and removed beyond the two named scripts.**
  AC3 ("no duplicated Slack architecture") led to auditing
  `skills/morning-assistant/SKILL.md` (the orchestrator), which still
  independently re-implemented a Slack enrich/generate/stage draft pass
  (Step 4) predating slice 004-02's native-draft Step 3 inside
  `morning-slack/SKILL.md` itself. Updated the orchestrator to defer to the
  sub-agent's own drafting instead of duplicating it — this was not called
  out in the slice's own Goal/ACs but is squarely inside "no duplicated Slack
  architecture."
- **Two independent-review cycles.** The first compliance pass returned
  `needs-changes` for two issues: a stale forward-reference in
  `skills/morning-slack/SKILL.md` ("see slice 004-03 ... once it's written" —
  written by this very slice) and a premature "this spec is now closed (all
  3 slices DONE)" claim in `docs/refinement-todo.md` while the slice's own
  frontmatter was still `IN_PROGRESS`. Both fixed; the re-review passed
  clean. The craft pass passed on the first attempt with three non-blocking
  nits, one of which (a source-of-truth pointer in
  `config/main.example.json` citing the slice file instead of
  `docs/architecture.md`'s named subsection, for consistency with the other
  two edited files) was fixed inline since it was a trivial one-line change;
  the other two (a tense-consistency nit in `docs/architecture.md` and minor
  Step 1/Step 3 near-duplication in `skills/morning-slack/SKILL.md`, which
  already partially cross-references) were left as-is — low risk, and the
  first resolves naturally once this slice reaches `DONE`.
- **Two residual gaps found, deliberately left out of scope, recorded with a
  landing spot.** (1) `config/main.example.json`'s `tools.slack.gather_method`/`gather_fallback`
  fields still use a pre-plugin `connector`/`script`/`browser` taxonomy that
  doesn't model the plugin as a gather method at all, and
  `morning-slack/SKILL.md` doesn't consult those fields regardless — a
  pre-existing drift from before 004-01, not introduced here. (2) Root
  `CLAUDE.md` (legacy project bible) still references `stage-slack-draft.js`
  in its per-tool table and Draft delivery rule paragraph. Both are named in
  `docs/refinement-todo.md`'s closing note with their resolution trigger
  (spec `008`'s script-and-config-contracts / legacy-Cowork-doc-triage
  slices) rather than fixed here or silently dropped.

### Reconciliation sweep

- **`docs/architecture.md`** — updated. Added "Slack: Plugin-First With
  Bounded Fallbacks" under Core architecture decisions (this is the first
  edit to this file across the whole spec — slices 004-01/004-02 both
  no-op'd it, per 004-01's Amendments note and 004-02's own sweep). Also
  tightened the "Current important integrations" Slack bullet.
- **`docs/refinement-todo.md`** — updated. Closed out "Resolved: Slack
  plugin versus Slack scripts" with a closing note naming both residual gaps
  and their resolution triggers (spec `008`).
- **`docs/specs/README.md`** — updated. The reconciliation review caught
  that the board had gone stale at `DRAFT` (two transitions behind this
  slice's real `IN_PROGRESS`/`REVIEWED` frontmatter progression) — a
  regen wasn't run at each transition the way slice-02's own sweep did.
  Re-ran `workflow.py status-board .` now; the board shows `004-03` as
  `REVIEWED`. Will regenerate once more after this slice's `DONE`
  transition, at which point spec 004 rolls up to `DONE`.
- **`docs/decisions/adr-0005-slack-plugin-native-drafts.md`** and
  **`docs/decisions/ADR-002-draft-generation-and-delivery.md`** — no-op.
  Both already correctly mark the Slack delivery row as superseded (from
  slice 004-02); this slice's script deletion is a direct, uncontroversial
  consequence of that already-Accepted decision, not a new one — no ADR
  update needed.
- **Load-bearing decision (ADR trigger) check** — no-op. Retiring
  `scripts/stage-slack-draft.js` and de-duplicating the orchestrator's draft
  logic are direct consequences of already-Accepted ADR-0005, not a new
  load-bearing choice with rejected alternatives. No new ADR warranted.
- **`docs/conventions.md`** — no-op. No new project-wide rule introduced;
  the fallback-boundary documentation is Slack-specific, not a pattern for
  other tools yet.
- **`docs/decisions/lightweight-decisions.md`** — no-op (file doesn't exist
  yet). No UI/visual/brand-level decisions were made in this slice.
- **`docs/inbox.md`** — no-op. Empty at slice start; nothing to sweep.
- **Closed-spec drift check** — no amendment needed. Slice `004-02`'s own
  Deviation log said `scripts/stage-slack-draft.js` "is left in place;
  whether to delete it is explicitly deferred to slice 004-03's
  fallback/dead-code decision" — that statement was accurate when written
  and correctly predicted this slice's resolution; it is not now-inaccurate,
  so no dated amendment is warranted (per ADR-0010, amendments correct
  errors, not the natural resolution of an explicitly-deferred item).
  `docs/decisions/ADR-002-draft-generation-and-delivery.md` already marks
  its Slack row as superseded and doesn't name the script directly — no
  drift there either.
- **Primer hygiene** — this slice closes spec `004` (all 3 slices DONE
  after this transition). Checked `CLAUDE.md` and `AGENTS.md`: both carry
  Slack-related content that is stale relative to this spec (`CLAUDE.md`'s
  per-tool table still names `stage-slack-draft.js`; `AGENTS.md`'s "Current
  Slice Priority" list predates the jig spec-numbering system entirely —
  it still lists "AI Radar" first even though that spec, 002, is already
  DONE). Both are pre-existing drift that predates this slice, not
  introduced by it, and both are already tracked for spec `008`'s
  legacy-Cowork-doc-triage / script-and-config-contracts slices (see the
  Deviation log above and `docs/refinement-todo.md`). Deliberately left
  as-is here rather than partially patched, to avoid a piecemeal rewrite of
  a primer surface that spec `008` will do properly in one pass.
- **Memory-sync** — run separately via `/jig:memory-sync` after this
  reconciliation lands.
- **Use-case coverage (advisory)** — this project's `docs/product-vision.md`
  has no `## Use cases` section (`no_section`), so this check is a no-op per
  ADR-0025.
- **Reconciliation review** — recorded as `docs/specs/004-slack-plugin-triage/reviews/slice-03-reconciliation.md` once this pass's verdict is written via `record-review` (forward reference — the file is created as a result of recording this exact pass, not a dangling link).

