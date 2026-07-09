---
slice: 007-01 - jira-mcp-brief-section
pass: craft
verdict: pass
reviewer: jig:reviewer (craft, fresh/read-only, re-review)
reviewed_at: 2026-07-02T16:10:46Z
prompt_source: scratchpad/rev-01-craft.txt
---

VERDICT: pass  (re-review after addressing prior needs-changes [blocker])

REASONING:
The three deliverables (morning-jira/SKILL.md, architecture.md's new "Jira:
MCP-First With Bounded Fallbacks" subsection, and the sample) match the slice's
MCP-first-with-fallback scope and mirror the sibling morning-slack pattern
(identical `{scripts_path}/../config/<tool>.json` resolution, same three-pass
scan, same never-silently-substitute + Coverage discipline). Architecture doc is
internally consistent with the fetch-jira.js contract; the sample is honestly
labeled (Part 1 template, Part 2 real fallback run whose `JIRA_BASE_URL not set`
output matches the script's actual env-check-first behavior). All cross-refs
resolve. Only minor polish nits remain; nothing blocks REVIEWED.

PRIOR BLOCKER (resolved): first craft pass flagged SKILL.md Load-config path as a
misdirect (misread `{scripts_path}` as a skills/ subdir). Addressed by adding an
explicit clarification that `{scripts_path}/../config/jira.json` resolves to the
project-root `config/jira.json` (matches scripts/lib/config.js loader + all 7
sibling skills). Re-review confirmed the resolution is correct and consistent.

SPECIFIC ISSUES:
- [strength] SKILL.md:60-75 — fallback-scope note states the script path runs the
  same three-pass scan over the same `projects` scope (strict subset) and the
  local-MD draft path is gather-path-independent. Coherent with the Slack boundary.
- [strength] SKILL.md:105,187-194 — Coverage line + "never silently substitute"
  rule + self-check block make the fallback observable at the user surface.
- [strength] sample-jira-2026-07-02.md:1-13,45-71 — honest template/real-run split
  satisfies the DoD "clear unavailable note" without fabricating live data.
- [nit] SKILL.md:26-35,113 — Load config extracts url/projects/lookback but Step 3
  gates on `draft_enabled`, which is not listed; jira.example.json doesn't document
  it either. SKILL-side clarity nit (address in reconcile: list draft_enabled;
  example-file documentation deferred to 008). Non-blocking.

RECONCILIATION NOTES:
- config/jira.example.json note "Copy to jira-filters.json" vs SKILL "create
  jira.json" — stale drift; deferred to spec 008-02.
- Pre-existing out-of-boundary nits (confirmed, not introduced here): fetch-jira.js
  :278,285 stale `jira-filters.json` refs; architecture.md:54 tech-stack "transitions"
  bullet vs read-only guarantee. Deviation-log items, deferred to 008.
- Capture subset-fallback + observable-gather-path Coverage framing as the
  reference pattern for slices 007-02 and 007-03.

Reviewer: jig:reviewer subagent (craft pass, fresh/read-only, re-review).
