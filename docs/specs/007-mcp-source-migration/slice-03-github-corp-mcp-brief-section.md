---
status: DONE
dependencies: ["003-01"]
last_verified: 2026-07-02
arch_review: true
---

## Slice 007-03 - github-corp-mcp-brief-section

**Goal:** Use corporate GitHub MCP tools for notification, PR, review, and
failed-job context in the daily brief.

**DoR:**
- [ ] Corporate GitHub MCP tools can access target repos. _(Not verifiable in the
  implementing session — no corporate GitHub MCP server / credentials present; the
  SKILL targets the MCP tools available in the running Codex session. See deviation
  log.)_
- [x] Existing corporate GitHub script behavior is understood.
  _(`scripts/fetch-github-corp.js` + `scripts/lib/github/**` + the spec-005 pipeline
  reviewed; envelope + review-request/CI-failure shapes covered by existing tests.)_

**Acceptance Criteria:**

1. **PR and issue activity is summarized.** The daily section includes review
   requests, mentions, authored PR activity, and failed CI when configured.
2. **Failed jobs are actionable.** Prow or check failures include enough name
   and link context to decide whether to investigate.
3. **The workflow stays read-first.** No merge, push, close, approve, or
   request-changes action happens in the daily brief path.

**DoD:**
- [x] Sample output includes one PR or failure item when available.
- [x] Relationship to spec 005 PR review automation is documented.

**Anti-horizontal-phasing check:** Corporate GitHub contributes real daily
signals without custom API scripts being the primary path.

### Deviation log (after reconciliation)

**Implemented (mirrors DONE Jira 007-01 + Confluence 007-02 + Slack per ADR-0004):**
- `skills/morning-github/SKILL.md`: the **corporate** GitHub gather path is now
  MCP-first (notification list → PR list + PR context/diff/checks → check-runs/Prow
  failures → issue read) with `scripts/fetch-github-corp.js --brief/--search/--context`
  fallback → browser last resort; "report which path ran" + Coverage note; fallback
  framed as a documented subset; `{scripts_path}` → repo-root `config/github.json`
  clarification included from the start.
- The **github.com** path (connector + `fetch-github-com.js`) is UNCHANGED (explicit
  scope note), and the **spec-005 / ADR-0007 review-first pipeline** (Step 3:
  `list-review-requests.js` → `fetch-github-{com,corp}.js --context` → `pr-review`
  skill → `write-review-artifact.js` → opt-in `stage-review-if-enabled.js`) is
  preserved verbatim and referenced as the single source of truth ("Do not duplicate
  or rewrite it").
- `docs/architecture.md`: new "Corporate GitHub: MCP-First With Bounded Fallbacks"
  subsection (primary/fallback/last-resort/read-first/coverage) with a
  github.com-unchanged scope note and the spec-005/ADR-0007 relationship by reference.
- `docs/specs/007-mcp-source-migration/sample-github-corp-2026-07-02.md`: honest
  sample (Part 1 illustrative template — corp PR review-request + failed CI/Prow items
  with named jobs + links; Part 2 real `fetch-github-corp.js --brief` `ok:false`
  fallback envelope → AC1/AC2 + DoD).

**AC coverage:** AC1 (review requests, mentions, authored-PR activity, failed CI
summarized + Coverage note); AC2 (failed jobs name the failing job(s) + link, bare
"CI failing" forbidden); AC3 (read-first — no merge/push/close/approve/request-changes
on any instance or gather path; pending review opt-in + never submits; issue replies
local-MD only).

**Environmental limitation (honest, not fabricated):** no corporate GitHub MCP server
and no credentials in the implementing session; the MCP path is written for "the MCP
tools available in the running session" (the Codex runtime). Only the script-fallback
path is offline-verifiable (sample Part 2).

**Fixes during reconciliation (craft nit):**
- Corrected the SKILL daily-note example's Corporate `#91` row arrow label from
  `[Pending review staged]` to `[Review artifact staged]` — the default (not-opted-in)
  path, consistent with that PR's artifact-only entry in the same example's Reviews
  section and with the sample's convention (pending-review label is reserved for the
  opt-in case).

**Deferred (resolution trigger = spec 008-02 script-and-config-contracts):**
- `config/github.example.json` / `config/main.example.json` `gather_method` taxonomy
  (no plugin/MCP method for corp) — SKILL prose is the source of truth here.
- `output/github-reviews/` review-artifact path is a de-facto contract surface not yet
  listed under `docs/architecture.md`'s "Contract surfaces" (arch nit) — track for 008.

**Nits left as-is (non-blocking):** the SKILL `description` frontmatter is dense (arch
nit, cosmetic); the corp MCP tool identifiers are referenced by capability/operation
(env-specific, resolved in the running Codex session) rather than named (craft nit —
a deliberate convention shared with the Jira/Confluence slices).

**Scope guard held:** no config-example/main.example edits, no script or
`scripts/lib/**` changes (github.com path + spec-005 pipeline untouched), no test
changes. Suite green (47/47).

**ADR-0004:** this is the last 007 slice — its `Proposed → Accepted` flip is done at
the spec-level reconcile that follows (007 realizes ADR-0004's Option B across all
three slices).

### Reconciliation sweep

- `skills/morning-github/SKILL.md` — **updated** (corp gather MCP-first; github.com +
  spec-005 pipeline preserved; config-path clarification; daily-note arrow-label fix).
- `docs/architecture.md` — **updated** (new Corporate GitHub subsection).
- `config/github.example.json`, `config/main.example.json` — **deferred**
  (`gather_method` taxonomy → 008-02).
- `scripts/fetch-github-corp.js`, `scripts/fetch-github-com.js`,
  `scripts/list-review-requests.js`, `scripts/write-review-artifact.js`,
  `scripts/stage-review-if-enabled.js`, `scripts/lib/github/**` — **no-op** (fallback +
  spec-005 pipeline unchanged).
- `tests/` — **no-op** (prose slice; 47 tests green, incl. 4 github-*.test.js untouched).
- `docs/decisions/adr-0004` — **accepted at the spec-level reconcile** (Proposed → Accepted).
- `docs/refinement-todo.md` — **updated** (interim note for 007-03 deferrals).
- `docs/memory/learnings.md` — **no-op** (007-01 already captured the `{scripts_path}`
  + MCP-offline-verification patterns that apply here too).
- `docs/specs/README.md` (status board) — **updated** (regenerated via
  `workflow.py status-board` after each frontmatter transition).

