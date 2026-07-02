---
slice: 007-03 - github-corp-mcp-brief-section
pass: arch
verdict: pass
reviewer: jig:reviewer (arch, fresh/read-only)
reviewed_at: 2026-07-02T16:42:14Z
prompt_source: scratchpad/rev-03-arch.txt
---

VERDICT: pass

REASONING:
The change moves only the corporate GitHub gather path to MCP-first while explicitly
preserving the github.com connector/script path and the spec-005/ADR-0007 review
pipeline, documented coherently in architecture.md and the SKILL. The new "Corporate
GitHub: MCP-First With Bounded Fallbacks" subsection mirrors the sibling Jira/Confluence
subsections exactly (primary/fallback/last-resort/read-first/coverage), preserving
module boundaries — source fetchers gather but don't own synthesis; MCP is one more
gather surface behind the same JSON-envelope contract. The spec-005 pipeline is
documented as an unchanged relationship (referencing the canonical script chain +
ADR-0007), not duplicated; SKILL Step 3 says "Do not duplicate or rewrite it." All
referenced scripts + ADRs exist; no public contract altered.

SPECIFIC ISSUES:
- [strength] architecture.md:186-236 — corp subsection structurally consistent with
  Jira/Confluence; clean github.com-unchanged scope note; spec-005/ADR-0007 documented
  by reference (single source of truth).
- [strength] SKILL.md:144-148 — Step 3 labels the pipeline "spec 005 / ADR-0007,
  UNCHANGED" + "Do not duplicate or rewrite it"; MCP-first change scoped to gather/context.
- [nit] SKILL.md:3 — dense description frontmatter (four capability clauses in one line);
  cosmetic, body carries it more legibly.
- [nit] architecture.md — `output/github-reviews/` review-artifact path is now a
  de-facto contract surface not yet listed under "Contract surfaces"; track for 008.

RECONCILIATION NOTES:
- Nits are log-only (SKILL description density; eventual Contract-surfaces entry for
  output/github-reviews/ → 008). Not blockers.
- Bounded-subset fallback framing consistent across all three 007 subsections — log as pattern.

Reviewer: jig:reviewer subagent (arch, fresh/read-only).
