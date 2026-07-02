---
slice: 007-03 - github-corp-mcp-brief-section
pass: compliance
verdict: pass
reviewer: jig:reviewer (compliance, fresh/read-only)
reviewed_at: 2026-07-02T16:42:13Z
prompt_source: scratchpad/rev-03-compliance.txt
---

VERDICT: pass

REASONING:
All three ACs for slice 007-03 are met and consistently documented across the SKILL,
architecture doc, and sample. AC1 (PR/issue activity summarized with a required
Coverage note); AC2 (failed jobs name the failing job + link the run — bare "CI
failing" explicitly forbidden; sample shows named+linked prow/build jobs); AC3
(read-first: no merge/push/close/approve/request-changes on any gather path; pending
review opt-in + never submitted; issue replies local-MD only). The github.com path
and the spec-005/ADR-0007 review pipeline are documented as unchanged, and every
referenced pipeline script + ADR-0004/0007 exists on disk. The sample's Part 2
fallback error string matches `scripts/fetch-github-corp.js` output verbatim; Part 1
clearly labeled as a hand-authored template.

SPECIFIC ISSUES:
(none)

RECONCILIATION NOTES:
- Populate the deviation log (currently "_Not started._"); flip to DONE after; confirm
  the spec.md rollup at the spec-level reconcile.
- No contract surface touched (re-documents the corp gather path only) — no schema
  artifact required. No principle violations (advances P5 MCP-over-custom-API,
  preserves P4 graceful degradation + P6 user-controls-irreversible).

Reviewer: jig:reviewer subagent (compliance, fresh/read-only).
