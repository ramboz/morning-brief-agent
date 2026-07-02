---
status: DONE
dependencies: ["003-01"]
last_verified: 2026-07-02
arch_review: true
---

## Slice 007-01 - jira-mcp-brief-section

**Goal:** Produce a Jira daily brief section using Jira MCP tools before falling
back to `scripts/fetch-jira.js`.

**DoR:**
- [ ] Jira MCP auth works for issue search/read operations. _(Not verifiable in
  the implementing session — no Jira MCP server / credentials present; the SKILL
  targets the MCP tools available in the running Codex session. See deviation log.)_
- [x] Existing Jira spec/script behavior has been reviewed for required fields.

**Acceptance Criteria:**

1. **Relevant Jira items are fetched.** Assigned issues, mentions, and recently
   discussed tickets can be surfaced from configured scope.
2. **The Markdown section is actionable.** Items include why they matter and
   whether a response or decision is needed.
3. **The script fallback remains available.** If MCP is unavailable, the
   workflow can report fallback status instead of failing silently.

**DoD:**
- [x] Sample output includes at least one Jira item or a clear no-results note.
- [x] The workflow never changes Jira status.

**Anti-horizontal-phasing check:** The user gets a Jira section in the daily
brief without relying on custom REST code first.

### Deviation log (after reconciliation)

**Implemented (mirrors the DONE Slack pattern per ADR-0004):**
- `skills/morning-jira/SKILL.md` rewritten MCP-first: primary = Jira MCP tools
  (three-pass issue search assigned/commented/mentioned + issue-read enrichment),
  fallback = `scripts/fetch-jira.js --brief/--search/--context`, browser last
  resort; "report which path ran" + Coverage note; preserved v1 triage + local-MD
  draft path (gated on `draft_enabled`); inline read-only / never-change-status.
- `docs/architecture.md`: new "Jira: MCP-First With Bounded Fallbacks" subsection.
- `docs/specs/007-mcp-source-migration/sample-jira-2026-07-02.md`: honest sample —
  Part 1 explicitly-labeled illustrative format template; Part 2 a real
  `fetch-jira.js --brief` run showing the `ok:false` graceful-degradation envelope
  (AC3 / DoD "clear no-results note").

**Environmental limitation (honest, not fabricated):** no Jira MCP server and no
credentials were available in the implementing session; the MCP path is written
for "the Jira MCP tools available in the running session" (the Codex runtime).
Only the script-fallback path is offline-verifiable, which is what the sample's
Part 2 captures.

**Deviations from plan / fixes during review:**
- Craft pass raised a `[blocker]` reading the Load-config path
  `{scripts_path}/../config/jira.json` as a non-existent `skills/`-relative path.
  Addressed by clarifying inline that `{scripts_path}` is the repo `scripts/` dir
  (from `config/main.json`), so the path resolves to the project-root
  `config/jira.json` — matching `scripts/lib/config.js` and all seven sibling
  skills. (The arch pass had independently validated the same line as correct; the
  fix improves isolated-reader clarity without diverging from the house
  convention.) Re-review → pass.
- Reconciliation: added `draft_enabled` to the Load-config extract list (craft
  nit — Step 3 gated on a field the config step didn't name).

**Deferred (resolution trigger = spec 008-02 script-and-config-contracts):**
- `config/jira.example.json` has no `draft_enabled` field and its `note` still
  says "Copy to `jira-filters.json`" (stale).
- `scripts/fetch-jira.js:278,285` error strings reference the retired
  `skills/morning-jira/config/jira-filters.json` path.
- `docs/architecture.md` Tech-stack bullet still lists Jira MCP "transitions"
  (capability vs. policy; the new subsection states the read-only policy clearly).
- Scope guard held: no config-example/taxonomy or `main.example.json` edits, no
  script edits, no test changes — SKILL prose is the source of truth here (same
  choice spec 004 made). Existing test suite remained green (47/47).

**ADR-0004:** cited as the governing decision; its `Proposed → Accepted` flip is
tracked for the spec-level reconcile once all three 007 slices land (it governs
all three, not just this one).

### Reconciliation sweep

- `skills/morning-jira/SKILL.md` — **updated** (MCP-first rewrite; config-path
  clarification; `draft_enabled` added to Load-config extract).
- `docs/architecture.md` — **updated** (new Jira subsection). Tech-stack
  "transitions" bullet — **deferred** (008-02).
- `config/jira.example.json` — **deferred** (`draft_enabled` + stale note → 008-02).
- `scripts/fetch-jira.js`, `scripts/lib/config.js` — **no-op** (fallback
  unchanged); stale error strings **deferred** (008-02).
- `config/main.example.json` — **no-op** (`gather_method` taxonomy deferred to
  008-02 per scope guard).
- `tests/` — **no-op** (prose slice; 47 tests green, untouched).
- `docs/decisions/adr-0004` — **deferred to spec-level reconcile** (accept once
  all three slices land).
- `docs/refinement-todo.md` — **updated** (logged the deferred config-contract
  items with the 008-02 trigger).
- `docs/memory/learnings.md` — **updated** (memory-sync: `{scripts_path}`
  resolution + MCP-first-offline-verification pattern).
- `docs/specs/README.md` (status board) — **updated** (regenerated via
  `workflow.py status-board` after each frontmatter transition so 007-01 reflects
  its current lifecycle state; per `docs/memory/learnings.md`, board regen follows
  every transition rather than being deferred to a later one).

