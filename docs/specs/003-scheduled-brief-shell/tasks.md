# Spec 003 Tasks

## Slice 003-01 - manual-brief-writer

- [x] Claim slice and confirm AI Radar dependency is done.
- [x] Add focused Node tests for brief rendering, AI Radar adaptation, and output
      file writing.
- [x] Implement manual Daily Brief writer command.
- [x] Document output convention and fixture-backed smoke run.
- [x] Verify manual run locally.
- [x] Run review/reconciliation flow before closing the slice.

## Slice 003-02 - codex-automation-proposal

- [x] Claim slice and confirm `003-01` is done.
- [x] Resolve ADR-0006 for the scheduled-run mechanism.
- [x] Add a reviewable automation operations note with prompt, output, and
      failure behavior.
- [x] Propose the Codex automation through the automation tool.
- [x] Verify docs and manual brief command still work.
- [x] Run review/reconciliation flow before closing the slice.

## Slice 003-03 - failure-reporting-state

- [x] Claim slice and confirm `003-01` is done.
- [x] Add focused Node tests for state load/update/write and a simulated
      source-failure render.
- [x] Implement `scripts/lib/brief/state.js` and wire it into `write-brief.js`.
- [x] Extend `renderDailyBrief` to surface last-success / failure-streak info
      for currently-failed sources.
- [x] Add any new state path to `.gitignore`.
- [x] Verify manual run locally (including a simulated failure).
- [x] Run review/reconciliation flow before closing the slice.
