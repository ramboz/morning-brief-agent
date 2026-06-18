---
status: DRAFT
dependencies: []
last_verified: 2026-06-18
arch_review: true
---

## Slice 004-01 - bounded-digest-and-triage

**Goal:** Generate a Slack daily digest and personal triage section from an
explicitly configured or user-provided scope.

**DoR:**
- [ ] Slack plugin tools are available in the active Codex session.
- [ ] Candidate channels, DMs, people, or topics are known.

**Acceptance Criteria:**

1. **Scope is explicit.** The workflow does not claim workspace-wide coverage
   unless the plugin can actually provide it.
2. **Digest highlights decisions and blockers.** The output prioritizes asks,
   blockers, ownership changes, incidents, and deadlines.
3. **Personal triage is separated.** Items needing the user's reply or action
   are distinguishable from "worth skimming" items.

**DoD:**
- [ ] A sample digest/triage output is captured in the spec close-out.
- [ ] Coverage gaps are noted rather than hidden.

**Anti-horizontal-phasing check:** The user gets a Slack section they can act on
without reading channel history manually.

### Deviation log (after reconciliation)

_Not started._

