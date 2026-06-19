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
