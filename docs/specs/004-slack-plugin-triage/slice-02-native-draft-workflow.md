---
status: DRAFT
dependencies: ["004-01"]
last_verified: 2026-06-18
arch_review: true
---

## Slice 004-02 - native-draft-workflow

**Goal:** Prepare Slack-native reply drafts for likely replies while preserving
the "never send unattended" safety rule.

**DoR:**
- [ ] ADR-0005 is accepted or explicitly approved for this slice.
- [ ] Slack plugin draft tools are available and authenticated.

**Acceptance Criteria:**

1. **Drafts are review-first.** The workflow creates Slack drafts only when the
   user has enabled draft behavior or requested it.
2. **Drafts preserve context.** Each draft links or points back to the source
   channel, DM, or thread.
3. **Existing draft conflicts are safe.** If Slack reports an attached draft
   already exists, the workflow stops and reports that it cannot overwrite it.

**DoD:**
- [ ] Draft behavior is tested in a low-risk destination or dry-run equivalent.
- [ ] Daily note output surfaces draft links or draft status.

**Anti-horizontal-phasing check:** The user has a reviewable Slack draft ready
where the conversation is happening, without the assistant sending it.

### Deviation log (after reconciliation)

_Not started._

