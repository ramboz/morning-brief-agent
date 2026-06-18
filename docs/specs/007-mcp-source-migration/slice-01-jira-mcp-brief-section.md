---
status: DRAFT
dependencies: ["003-01"]
last_verified: 2026-06-18
arch_review: true
---

## Slice 007-01 - jira-mcp-brief-section

**Goal:** Produce a Jira daily brief section using Jira MCP tools before falling
back to `scripts/fetch-jira.js`.

**DoR:**
- [ ] Jira MCP auth works for issue search/read operations.
- [ ] Existing Jira spec/script behavior has been reviewed for required fields.

**Acceptance Criteria:**

1. **Relevant Jira items are fetched.** Assigned issues, mentions, and recently
   discussed tickets can be surfaced from configured scope.
2. **The Markdown section is actionable.** Items include why they matter and
   whether a response or decision is needed.
3. **The script fallback remains available.** If MCP is unavailable, the
   workflow can report fallback status instead of failing silently.

**DoD:**
- [ ] Sample output includes at least one Jira item or a clear no-results note.
- [ ] The workflow never changes Jira status.

**Anti-horizontal-phasing check:** The user gets a Jira section in the daily
brief without relying on custom REST code first.

### Deviation log (after reconciliation)

_Not started._

