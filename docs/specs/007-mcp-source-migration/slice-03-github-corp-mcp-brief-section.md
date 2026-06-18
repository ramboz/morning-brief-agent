---
status: DRAFT
dependencies: ["003-01"]
last_verified: 2026-06-18
arch_review: true
---

## Slice 007-03 - github-corp-mcp-brief-section

**Goal:** Use corporate GitHub MCP tools for notification, PR, review, and
failed-job context in the daily brief.

**DoR:**
- [ ] Corporate GitHub MCP tools can access target repos.
- [ ] Existing corporate GitHub script behavior is understood.

**Acceptance Criteria:**

1. **PR and issue activity is summarized.** The daily section includes review
   requests, mentions, authored PR activity, and failed CI when configured.
2. **Failed jobs are actionable.** Prow or check failures include enough name
   and link context to decide whether to investigate.
3. **The workflow stays read-first.** No merge, push, close, approve, or
   request-changes action happens in the daily brief path.

**DoD:**
- [ ] Sample output includes one PR or failure item when available.
- [ ] Relationship to spec 005 PR review automation is documented.

**Anti-horizontal-phasing check:** Corporate GitHub contributes real daily
signals without custom API scripts being the primary path.

### Deviation log (after reconciliation)

_Not started._

