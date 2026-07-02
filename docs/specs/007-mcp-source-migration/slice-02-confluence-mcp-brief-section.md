---
status: DONE
dependencies: ["003-01"]
last_verified: 2026-07-02
arch_review: true
---

## Slice 007-02 - confluence-mcp-brief-section

**Goal:** Produce a read-only Confluence update section using wiki MCP tools.

**DoR:**
- [ ] Wiki MCP auth works for search and page reads. _(Not verifiable in the
  implementing session — no Confluence/wiki MCP server / credentials present; the
  SKILL targets the MCP tools available in the running Codex session. See
  deviation log.)_
- [x] Watched spaces or pages are configured. _(`config/confluence.example.json`
  ships a `spaces` list as the scope template.)_

**Acceptance Criteria:**

1. **Relevant page updates are fetched.** The section can list watched page
   changes, mentions, or search hits from configured scope.
2. **The section is read-only.** The workflow does not edit pages or comments.
3. **State is minimal.** Any page-version tracking is plain JSON and
   inspectable.

**DoD:**
- [x] Sample output includes at least one page update or clear no-results note.
- [x] Existing Confluence script fallback is documented.

**Anti-horizontal-phasing check:** The user can skim Confluence changes from the
daily brief without opening Confluence manually.

### Deviation log (after reconciliation)

**Implemented (mirrors the DONE Jira 007-01 + Slack pattern per ADR-0004):**
- `skills/morning-confluence/SKILL.md` rewritten MCP-first READ-ONLY: primary =
  Confluence/wiki MCP tools (recently-modified scan + mention hits, scoped to
  `spaces`), fallback = `scripts/fetch-confluence.js --brief/--search`, browser
  last resort; "report which path ran" + Coverage note; preserved v1 pre-filtering
  (`min_change_chars`, `exclude_title_patterns`, `skip_if_only_mentions`,
  `my_context_keywords`), prioritization, `changeSummary`/version/age format, and
  plain-JSON `wiki-state.json` version tracking. The `{scripts_path}` → repo-root
  `config/confluence.json` clarification was included from the start (007-01's
  craft finding pre-empted).
- `docs/architecture.md`: new "Confluence: MCP-First With Bounded Fallbacks"
  subsection (read-only guarantee; minimal plain-JSON state).
- `docs/specs/007-mcp-source-migration/sample-confluence-2026-07-02.md`: honest
  sample — Part 1 illustrative format template; Part 2 real `fetch-confluence.js
  --brief` `ok:false` fallback envelope (AC1 / DoD "clear no-results note").

**AC2 read-only — removed a pre-existing draft path:** the old SKILL had a
"Step 3 — DRAFT (local MD)" path piping page-comment drafts to
`scripts/stage-local-draft.js`. Removed the CALLER from the Confluence SKILL only
(policy alignment with CLAUDE.md "Confluence = None (read-only)" + architecture).
The shared `scripts/stage-local-draft.js` is a tool-agnostic writer and was **not**
touched — Jira/GitHub callers unaffected (all three review passes confirmed zero
blast radius).

**Environmental limitation (honest, not fabricated):** no Confluence/wiki MCP
server and no credentials in the implementing session; the MCP path is written for
"the MCP tools available in the running session" (the Codex runtime). Only the
script-fallback path is offline-verifiable (sample Part 2).

**Fixes during reconciliation (review nits):**
- Trimmed the `--context` over-claim from the architecture Confluence fallback
  line — the read-only SKILL only invokes `--brief`/`--search` (arch nit).
- Added a "wiki-state read is best-effort" note to the SKILL Load-config step: a
  missing file OR missing `~/.claude/skills/.../state/` tree (non-Cowork/Codex
  runtime) → treat all pages as new; the Step 3 write self-heals the dir (craft nit N1).

**Deferred (resolution trigger = spec 008-02 script-and-config-contracts):**
- `config/main.example.json` Confluence block still declares `gather_method:
  "script"` (taxonomy has no plugin/MCP method) **and** stale draft fields
  `draft_method: "local_md"` / `draft_enabled` plus a note about generating
  page-comment drafts — these now contradict the landed read-only-no-draft
  outcome. `config/confluence.example.json` likewise predates the MCP-first
  taxonomy. SKILL prose is the source of truth here; the example-config cleanup
  (including these stale Confluence draft fields) is deferred to 008-02.
- `scripts/fetch-confluence.js:517,524` + `config/confluence.example.json:20-27`
  still reference the legacy `confluence-spaces.json` filename (loader + SKILL use
  repo-root `config/confluence.json`).
- `scripts/stage-local-draft.js:10` JSDoc still lists `confluence` as a valid
  `tool` — stale after the draft-path removal (per compliance's suggestion, a
  refinement-todo/008 note rather than an in-slice shared-script edit).
- Scope guard held: no config-example/main.example edits, no test changes, no
  script LOGIC changes. Suite green (47/47).

**Acknowledged cosmetic (not fixed):** the sample shows two no-results renderings
under slightly divergent headings vs the SKILL's own format (craft nit N2) — both
valid; left as illustrative.

**ADR-0004:** cited as the governing decision; `Proposed → Accepted` flip tracked
for the spec-level reconcile once all three 007 slices land.

### Reconciliation sweep

- `skills/morning-confluence/SKILL.md` — **updated** (MCP-first read-only rewrite;
  draft path removed; config-path clarification; wiki-state best-effort note).
- `docs/architecture.md` — **updated** (new Confluence subsection; `--context`
  over-claim trimmed).
- `config/confluence.example.json`, `config/main.example.json` — **deferred**
  (`gather_method` taxonomy + legacy `confluence-spaces.json` note → 008-02).
- `scripts/fetch-confluence.js` — **no-op** (fallback unchanged); stale
  `confluence-spaces.json` error strings **deferred** (008-02).
- `scripts/stage-local-draft.js` — **no-op** (shared writer untouched; stale JSDoc
  `confluence` enum **deferred** to 008-02).
- `config/main.example.json` — **no-op** (taxonomy deferred to 008-02).
- `tests/` — **no-op** (prose slice; 47 tests green, untouched).
- `docs/decisions/adr-0004` — **deferred to spec-level reconcile**.
- `docs/refinement-todo.md` — **updated** (interim note for 007-02 deferrals).
- `docs/memory/learnings.md` — **no-op** (007-01 already captured the
  `{scripts_path}` + MCP-offline-verification patterns that apply here too).
- `docs/specs/README.md` (status board) — **updated** (regenerated via
  `workflow.py status-board` after each frontmatter transition).

