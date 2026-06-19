---
status: DONE
dependencies: ["003-01"]
last_verified: 2026-06-19
---

## Slice 003-02 - codex-automation-proposal

**Goal:** Define and, if approved, create the Codex automation that runs the
brief on a schedule.

**DoR:**
- [x] The manual brief workflow exists and is idempotent enough for repeated
      runs.
- [x] ADR-0006 has either been accepted or explicitly deferred.

**Acceptance Criteria:**

1. **The scheduled prompt is self-contained.** It names the workspace, run
   behavior, output expectations, and safety constraints.
2. **The automation is reviewable before activation.** If created through
   Codex automation tooling, the configuration is surfaced for user approval.
3. **The schedule does not hide failures.** Failures produce a clear note or
   thread result rather than silently doing nothing.

**DoD:**
- [x] Automation creation or deferral is recorded in the close-out.
- [x] No raw scheduler directives are hand-written outside the Codex automation
      tool contract.

**Anti-horizontal-phasing check:** The user can see exactly how the brief will
run on a schedule and what happens when it fails.

### Deviation log (after reconciliation)

- ADR-0006 was **accepted** (2026-06-19) rather than deferred: the manual brief
  writer from `003-01` made Codex automations the obvious minimal scheduled-run
  mechanism, so the decision was no longer ambiguous. The refinement-todo
  "Scheduled run mechanism" item was moved from Deferred to Resolved and the
  matching architecture "Still open" line was removed.
- The scheduled-run packet lives in `docs/operations/daily-brief-automation.md`
  as a reviewable operations note (workspace, name/state/schedule fields, task
  prompt, and failure behavior). No cron/launchd/daemon wrapper was added to the
  repo — the automation runs the existing `npm run brief` command, keeping the
  no-repo-scheduler boundary from the plan's out-of-scope list.
- **Failure contract is envelope-driven, not exit-code-driven.** `write-brief.js`
  always exits 0 (even for `ok:false` envelopes), so the automation prompt
  inspects the JSON envelope (`ok` false / non-empty top-level `errors` /
  invalid JSON / timeout) instead of the process exit code. This is the pattern
  future scheduled-run prompts should follow.
- Durable per-source failure state and hung-source isolation were intentionally
  left to `003-03`; the manual writer still shells out to the live AI Radar
  fetcher with no timeout, a risk carried forward in `docs/refinement-todo.md`.
- Craft-pass nits logged as non-blocking polish (not addressed this slice): the
  workspace path is hard-coded and repeated three times in the ops note; the
  "GPT-5.4 / medium effort" automation defaults are captured as point-in-time
  prose; and the command is named `npm run brief` in the ops note but
  `node scripts/write-brief.js --brief` in architecture/refinement docs (both
  resolve identically via `package.json`).
- Reviews: compliance **pass** (`reviews/slice-02-compliance.md`), craft **pass**
  (`reviews/slice-02-craft.md`). No arch or code-health pass — the slice changes
  no module boundaries or executable contract surface.
