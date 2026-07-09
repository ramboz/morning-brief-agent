---
slice: 007-02 - confluence-mcp-brief-section
pass: arch
verdict: pass
reviewer: jig:reviewer (arch, fresh/read-only)
reviewed_at: 2026-07-02T16:28:08Z
prompt_source: scratchpad/rev-02-arch.txt
---

VERDICT: pass

REASONING:
The change preserves documented module boundaries and applies the same "MCP-First
With Bounded Fallbacks" pattern established for Slack + Jira. The Confluence
subsection reads coherently against the siblings and the ADR-0004 policy it cites.
The draft-path removal is done at the wiring/policy layer: `scripts/stage-local-draft.js`
is a tool-agnostic writer simply no longer called from the Confluence SKILL — no
shared code broken, Jira/GitHub callers untouched (zero blast radius). No public
contract surface affected; read-only guarantee stated redundantly across SKILL,
architecture, and sample, closing the silent-draft failure mode.

SPECIFIC ISSUES:
- [strength] architecture.md:146-184 — mirrors the Slack/Jira subsections exactly
  in structure; new boundary coherent with the established pattern.
- [strength] SKILL.md:78-88 — fallback framed as a documented subset, not a
  competing implementation.
- [strength] stage-local-draft.js:34,103-105 — draft removal is a clean layering
  decision; shared writer stays generic, zero blast radius to Jira/GitHub.
- [nit] architecture.md:157 — Confluence fallback documented as `--brief/--search/--context`,
  but the read-only SKILL only invokes `--brief` + `--search`; `--context` never
  exercised (over-claim). Fix in reconcile.
- [nit] stage-local-draft.js:10 — JSDoc still lists `confluence` as a valid tool;
  stale after the draft removal.

RECONCILIATION NOTES:
- Draft removal = removed the Confluence caller, NOT the shared script — log precisely.
- architecture.md:157 --context over-claim + stage-local-draft.js:10 JSDoc = doc/code
  tidy; the former fixed in reconcile (my deliverable), the latter deferred to 008
  (shared script scope) per compliance's suggestion.
- ADR-0004 still "Proposed"; flip tracked for the spec-level reconcile.

Reviewer: jig:reviewer subagent (arch, fresh/read-only).
