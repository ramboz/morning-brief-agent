---
status: RECONCILED
dependencies: ["002-02"]
last_verified: 2026-06-19
arch_review: true
---

## Slice 003-01 - manual-brief-writer

**Goal:** Provide a manual brief command or workflow that writes a daily
Markdown note from available source sections, starting with AI Radar.

**DoR:**
- [x] AI Radar has a current fixture and stable Markdown output.
- [x] The output location convention is known or configurable.

**Acceptance Criteria:**

1. **Manual run writes a daily note.** Running the workflow creates or updates
   an Obsidian-ready Markdown file for the current date.
2. **Source sections are composable.** AI Radar is included as a section, and
   the shell can omit empty or failed sections cleanly.
3. **The output is inspectable.** The generated file path and source results
   are reported to the user or in the JSON envelope.

**DoD:**
- [x] Manual run has been verified locally.
- [x] The shell does not introduce a database, web server, or broad framework.
- [x] The spec records any deferred scheduler decisions in
      `docs/refinement-todo.md`.

**Anti-horizontal-phasing check:** A user can run one command/workflow and read
the first daily note, even before all source areas exist.

### Deviation log (after reconciliation)

- Implemented as a script-first CLI (`scripts/write-brief.js`) plus narrow
  helpers under `scripts/lib/brief/`, rather than a new orchestration framework.
- Added `npm run brief` and `npm test`; the test command uses Node's built-in
  runner and focused helper tests.
- Daily note output defaults to `output/daily`, with overrides via
  `--output-dir`, `DAILY_BRIEF_OUTPUT_DIR`, `daily_brief.output_dir`, or a
  configured Obsidian `vault_path` plus `daily_notes_folder`.
- Manual verification used the checked-in AI Radar fixture:
  `npm run brief -- --date 2026-06-18 --ai-radar-fixture tests/fixtures/ai-radar.json`.
- Review follow-ups captured in `docs/refinement-todo.md`: robust Markdown
  heading nesting, CLI envelope/wiring test coverage, and hung-source isolation
  before scheduled unattended runs.
- Architecture reconciliation fixed README wording so Daily Brief composition
  points at the script brief shell instead of legacy Cowork skills.
- No ADR added: this slice did not choose the scheduled-run mechanism; that
  remains deferred to `003-02`.
