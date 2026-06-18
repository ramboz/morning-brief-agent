---
dependencies: []
last_verified: 2026-06-18
---

# ADR-0003: Codex and jig as the spec-driven workflow

## Status

Proposed (2026-06-18)

## Context

Morning Assistant v2 is being revived from a back-burner project with legacy
Cowork-era docs, helper scripts, and source-area specs. The project now needs a
durable way to track decisions and vertical work without losing the old context.

The repo has been scaffolded with jig under `.codex/`, and `docs/specs/` now
contains the active status board. Existing `specs/*.md`, `CLAUDE.md`, and legacy
`skills/**` still contain useful historical details, but they are no longer the
best place to track new work.

## Decision Options Considered

### Option A: Keep the old Cowork documents as the source of truth
- **Pros:** Lowest immediate migration cost; keeps old instructions intact.
- **Cons:** New Codex/MCP/plugin decisions would stay scattered and the project
  would continue to drift across README, CLAUDE.md, skills, and specs.

### Option B: Use jig specs and ADRs as the active source of truth
- **Pros:** Gives each change a status, slice plan, review path, and decision
  trail; matches the user's requested SDD style.
- **Cons:** Requires filing specs/ADRs before substantial work and maintaining
  another docs layer.

### Option C: Rewrite the whole project plan before implementing
- **Pros:** Could produce a clean architecture narrative.
- **Cons:** Delays the useful vertical slices and risks turning revival into a
  documentation project.

## Recommended Decision

Use jig specs and ADRs as the active source of truth for new work. Keep legacy
docs and old `specs/*.md` as reference inputs until a specific jig spec ports or
supersedes them.

## Consequences

**Becomes easier:**
- Tracking scope and status for AI Radar, Slack, scheduling, GitHub reviews, and
  meeting summaries.
- Capturing hard-to-reverse choices as ADRs before implementation.
- Reviewing vertical slices independently.

**Becomes harder:**
- Small changes need judgment about whether they warrant a spec.
- Some old docs will remain temporarily duplicated until cleanup slices land.

## Open questions

- Which legacy Cowork skills should be ported versus retired?
- Should accepted old ADR filenames be normalized immediately or in spec 008?

