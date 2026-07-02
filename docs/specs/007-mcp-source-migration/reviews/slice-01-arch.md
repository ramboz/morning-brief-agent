---
slice: 007-01 - jira-mcp-brief-section
pass: arch
verdict: pass
reviewer: jig:reviewer (arch, fresh/read-only)
reviewed_at: 2026-07-02T16:07:47Z
prompt_source: scratchpad/rev-01-arch.txt
---

VERDICT: pass

REASONING:
The slice cleanly changes the Jira source's module boundary from script-first to
MCP-first-with-fallback and documents it in a new `docs/architecture.md`
subsection ("Jira: MCP-First With Bounded Fallbacks") that faithfully mirrors the
established Slack precedent, preserving the repo's light-coupling design (JSON
envelope in, Markdown out). Public contract surfaces (the `{ok,tool,mode,
timestamp,data,errors}` script envelope and config scope) are described
consistently across SKILL.md, architecture.md, and the sample; the fallback is a
strict subset of the primary path (same three-pass scan, same `projects` scope).
Read-only/never-change-status guarantees and the local-MD draft path are carried
through all three gather paths; ADR-0004 + ADR-002 references are accurate. No
architectural blockers.

SPECIFIC ISSUES:
- docs/architecture.md:111-144 — [strength] The subsection explicitly states the
  fallback is a strict subset of the primary path and the draft path is
  gather-path-independent — preserves coherence with the sibling Slack boundary.
- skills/morning-jira/SKILL.md:57-72 — [strength] "note which path was used —
  never silently substitute" + Coverage-line requirement makes the fallback
  observable at the user-facing surface.
- scripts/fetch-jira.js:278,284 — [nit] config-missing error messages point at
  the retired `skills/morning-jira/config/jira-filters.json`; loader + SKILL use
  repo-root `config/jira.json`. Pre-existing, not introduced here, outside arch
  boundary. Reconcile in follow-up (spec 008).
- docs/architecture.md:47,54 — [nit] Tech-stack bullet still says Jira MCP covers
  "comments, and transitions," in tension with the new read-only/no-comment-add
  guarantee. Capability-vs-policy, not contradictory; a one-word clarification
  keeps the doc internally coherent.

RECONCILIATION NOTES:
- Capture the subset-fallback framing + observable-path Coverage rule as the
  reference pattern for slices 007-02 and 007-03.
- fetch-jira.js config-path message drift + Tech-stack "transitions" phrasing are
  deviation-log nits, not blockers.
- Sample's honest labeling (Part 1 template, Part 2 real fallback run) is
  appropriate transparency given no in-session MCP/creds.

Reviewer: jig:reviewer subagent (arch pass), fresh context, read-only.
