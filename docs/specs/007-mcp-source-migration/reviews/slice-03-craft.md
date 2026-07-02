---
slice: 007-03 - github-corp-mcp-brief-section
pass: craft
verdict: pass
reviewer: jig:reviewer (craft, fresh/read-only)
reviewed_at: 2026-07-02T16:42:14Z
prompt_source: scratchpad/rev-03-craft.txt
---

VERDICT: pass

REASONING:
Documentation/skill slice migrating the corporate GitHub gather path to MCP-first.
The three deliverables are internally consistent and faithful to the repo: every
referenced script (`fetch-github-corp.js --brief/--search/--context`,
`list-review-requests.js`, `write-review-artifact.js`, `stage-review-if-enabled.js`,
`discard-github-review.js`) and ADR (0004, 0007) exists; `{scripts_path}/../config/github.json`
matches the sibling morning-jira pattern and resolves to project-root `config/`; the
sample's `-corporate-` artifact slug is consistent with `review-artifact.js`'s
sanitizer. Scope discipline exemplary — the github.com path and the spec-005 pipeline
are repeatedly fenced off as UNCHANGED; the sample is honest (Part 1 template, Part 2
real fallback run). Nits only.

SPECIFIC ISSUES:
- [strength] sample:8-16 — honest template-vs-real-run labeling; satisfies DoD without
  fabricating a live run.
- [strength] SKILL.md:21-34,63-69,144-148 — repeated unambiguous scope fencing of the
  github.com path + spec-005 pipeline as UNCHANGED.
- [strength] SKILL.md:99-109,335-347 — bounded-subset fallback framing + "never
  silently substitute" + ok:false→"unavailable" degradation, matching the sibling
  Bounded-Fallbacks pattern.
- [nit] SKILL.md:278 vs sample:36 — the SKILL daily-note example shows a review-request
  row ending `→ [Pending review staged]`, but the default (not-opted-in) path should
  show `→ [Review artifact staged]`; "Pending review staged" is reserved for the opt-in
  case (sample:50-53). Aligning the example arrow label removes a subtle mixed signal.
  Non-blocking (surrounding prose SKILL.md:294-300 states the rule correctly). FIX in reconcile.
- [nit] SKILL.md:73-76,316-321 — corp MCP tool identifiers deferred to
  capability/operation (env-specific); a one-line pointer to where they resolve at
  runtime would help. Deliberate convention (matches Jira/Confluence); optional.

RECONCILIATION NOTES:
- Fix the SKILL.md:278 arrow-label consistency (default path → "Review artifact staged").
- Optional: one-line pointer for env-specific MCP tool-identifier resolution.
- Carry the honest-labeling + scope-fencing + bounded-fallback strengths as repeatable patterns.

Reviewer: jig:reviewer subagent (craft, fresh/read-only).
