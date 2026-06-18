---
status: DRAFT
dependencies: ["003-01"]
last_verified: 2026-06-18
---

## Slice 003-02 - codex-automation-proposal

**Goal:** Define and, if approved, create the Codex automation that runs the
brief on a schedule.

**DoR:**
- [ ] The manual brief workflow exists and is idempotent enough for repeated
      runs.
- [ ] ADR-0006 has either been accepted or explicitly deferred.

**Acceptance Criteria:**

1. **The scheduled prompt is self-contained.** It names the workspace, run
   behavior, output expectations, and safety constraints.
2. **The automation is reviewable before activation.** If created through
   Codex automation tooling, the configuration is surfaced for user approval.
3. **The schedule does not hide failures.** Failures produce a clear note or
   thread result rather than silently doing nothing.

**DoD:**
- [ ] Automation creation or deferral is recorded in the close-out.
- [ ] No raw scheduler directives are hand-written outside the Codex automation
      tool contract.

**Anti-horizontal-phasing check:** The user can see exactly how the brief will
run on a schedule and what happens when it fails.

### Deviation log (after reconciliation)

_Not started._

