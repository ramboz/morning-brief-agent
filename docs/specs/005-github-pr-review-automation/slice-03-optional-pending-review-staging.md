---
status: DRAFT
dependencies: ["005-02"]
last_verified: 2026-06-18
arch_review: true
---

## Slice 005-03 - optional-pending-review-staging

**Goal:** Stage a pending GitHub review only when the repo/user config enables
native staging.

**DoR:**
- [ ] ADR-0007 is accepted or explicitly approved for this slice.
- [ ] The review artifact path from slice 005-02 exists.

**Acceptance Criteria:**

1. **Native staging is opt-in.** The default behavior remains local review
   artifacts unless configuration enables pending reviews.
2. **Pending reviews are never submitted.** The GitHub API call creates a
   pending review only; it does not approve, request changes, comment publicly,
   merge, or push.
3. **Fallback is safe.** If native staging fails, the local review artifact is
   preserved and surfaced.

**DoD:**
- [ ] Staging behavior is verified against a safe PR or dry-run substitute.
- [ ] Daily note / output links to the pending review or local artifact.

**Anti-horizontal-phasing check:** The user gets a draft in GitHub when they
explicitly want that UX, while preserving a local review-first fallback.

### Deviation log (after reconciliation)

_Not started._

