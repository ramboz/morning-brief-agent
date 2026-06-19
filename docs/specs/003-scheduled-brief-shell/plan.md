# Spec 003 Plan

## Slice 003-01 - manual-brief-writer

Ship the smallest manual Daily Brief writer that composes existing source
sections into one Markdown note.

1. Add a brief renderer that collects source actions, includes non-empty source
   Markdown sections, and records source results.
2. Add an AI Radar source adapter that can use the live fetcher or the checked-in
   fixture for deterministic local verification.
3. Add a manual CLI that writes dated and latest Markdown files to a configurable
   output directory.
4. Document the command and output convention, leaving scheduling decisions to
   slice `003-02`.

## Out of scope

- Scheduling or Codex automation setup.
- New source areas beyond AI Radar.
- Database, web server, or broad orchestration framework.

## Slice 003-02 - codex-automation-proposal

Create the smallest scheduled-run path using Codex automations, without adding
repo-owned scheduler code.

1. Accept or explicitly defer ADR-0006 so the scheduled-run mechanism is no
   longer ambiguous.
2. Record the automation prompt, expected output, and failure behavior in a
   reviewable operations note.
3. Propose the Codex automation through the app automation tool for user review
   before activation.
4. Update architecture/refinement docs so future slices know Codex automations
   own scheduling and `003-03` owns durable failure state.

## Out of scope for 003-02

- Adding a cron, launchd, or daemon wrapper to the repo.
- Building per-source failure state or hung-source isolation.
- Sending messages, comments, or other irreversible tool actions from scheduled
  runs.
