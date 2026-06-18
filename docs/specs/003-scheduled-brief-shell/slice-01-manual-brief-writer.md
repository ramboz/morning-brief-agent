---
status: DRAFT
dependencies: ["002-02"]
last_verified: 2026-06-18
arch_review: true
---

## Slice 003-01 - manual-brief-writer

**Goal:** Provide a manual brief command or workflow that writes a daily
Markdown note from available source sections, starting with AI Radar.

**DoR:**
- [ ] AI Radar has a current fixture and stable Markdown output.
- [ ] The output location convention is known or configurable.

**Acceptance Criteria:**

1. **Manual run writes a daily note.** Running the workflow creates or updates
   an Obsidian-ready Markdown file for the current date.
2. **Source sections are composable.** AI Radar is included as a section, and
   the shell can omit empty or failed sections cleanly.
3. **The output is inspectable.** The generated file path and source results
   are reported to the user or in the JSON envelope.

**DoD:**
- [ ] Manual run has been verified locally.
- [ ] The shell does not introduce a database, web server, or broad framework.
- [ ] The spec records any deferred scheduler decisions in
      `docs/refinement-todo.md`.

**Anti-horizontal-phasing check:** A user can run one command/workflow and read
the first daily note, even before all source areas exist.

### Deviation log (after reconciliation)

_Not started._

