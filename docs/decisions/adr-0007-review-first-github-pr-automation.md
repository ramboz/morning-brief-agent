---
dependencies: []
last_verified: 2026-07-01
---

# ADR-0007: Review-first GitHub PR automation

## Status

Accepted (2026-07-01)

Accepted to unblock spec 005 implementation. The recommended decision below is
adopted as-is: detect review-requested PRs (slice 005-01), run the `pr-review`
skill and write a local review artifact first (slice 005-02), and allow native
GitHub *pending*-review staging only as an explicit per-repo/run opt-in
(slice 005-03). Never submit, approve, request changes, merge, or push.

## Context

The user wants the project to automatically run the PR review skill for GitHub
PRs they are asked to review, probably detectable through GitHub notifications.
The repo already has a `stage-github-review.js` pending-review path, and the
current environment also has corporate GitHub MCP tools.

The risk is that an automated review could become too eager: posting, approving,
requesting changes, or otherwise implying the human has reviewed code when they
have not.

## Decision Options Considered

### Option A: Detect review requests and write local review artifacts only
- **Pros:** Safest; keeps review output inspectable before any GitHub staging.
- **Cons:** Requires an extra step to move the draft into GitHub.

### Option B: Create pending GitHub reviews when enabled
- **Pros:** Uses GitHub's native draft review UX; invisible until the user
  submits.
- **Cons:** Needs per-repo/user enablement and careful fallback behavior.

### Option C: Submit comments or review decisions automatically
- **Pros:** Maximum automation.
- **Cons:** Violates the project's safety constraints and review integrity.

## Recommended Decision

Detect review-requested PRs, run the `pr-review` skill, and write a local review
artifact by default. Allow pending GitHub review staging only as an explicit
opt-in per repo or run. Never submit, approve, request changes, merge, or push
from the scheduled path.

## Consequences

**Becomes easier:**
- Review requests become visible in the daily brief.
- Draft reviews can be prepared while preserving human review authority.

**Becomes harder:**
- The workflow needs enough PR context to avoid shallow reviews.
- Native pending-review staging requires careful config and error handling.

## Resolved questions

- **Where do review artifacts live?** In a repo-local `output/github-reviews/`
  directory (resolved 2026-07-01). Git-visible and editable before any GitHub
  staging; no Obsidian-vault dependency. Surfacing a link in the daily note can
  be layered on later without moving the source of truth.
- **Which repos allow pending-review staging?** None by default. Native
  pending-review staging is opt-in per repo/run via config (slice 005-03); the
  default behavior is local review artifacts only.

