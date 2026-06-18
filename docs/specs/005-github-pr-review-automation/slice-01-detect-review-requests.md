---
status: DRAFT
dependencies: []
last_verified: 2026-06-18
arch_review: true
---

## Slice 005-01 - detect-review-requests

**Goal:** Surface GitHub PRs where the user has been asked to review, using
notifications or MCP tools where available.

**DoR:**
- [ ] GitHub.com and/or corporate GitHub access path is available.
- [ ] The detection path can distinguish review requests from generic PR
      activity.

**Acceptance Criteria:**

1. **Review requests are detected.** The output includes repo, PR number,
   title, author, URL, and why it was surfaced.
2. **Noise is filtered.** Authored PR activity, mentions, and CI updates are
   not mixed into the review-request queue unless configured.
3. **Both GitHub surfaces are modeled.** GitHub.com and corporate GitHub can
   be enabled independently.

**DoD:**
- [ ] Detection output is captured as fixture or sample JSON with sensitive
      repo data redacted if needed.
- [ ] Failures mention auth, VPN, or connector availability clearly.

**Anti-horizontal-phasing check:** The user gets a concrete "PRs you were asked
to review" list without opening GitHub notifications manually.

### Deviation log (after reconciliation)

_Not started._

