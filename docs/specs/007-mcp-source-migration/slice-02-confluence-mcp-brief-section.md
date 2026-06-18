---
status: DRAFT
dependencies: ["003-01"]
last_verified: 2026-06-18
arch_review: true
---

## Slice 007-02 - confluence-mcp-brief-section

**Goal:** Produce a read-only Confluence update section using wiki MCP tools.

**DoR:**
- [ ] Wiki MCP auth works for search and page reads.
- [ ] Watched spaces or pages are configured.

**Acceptance Criteria:**

1. **Relevant page updates are fetched.** The section can list watched page
   changes, mentions, or search hits from configured scope.
2. **The section is read-only.** The workflow does not edit pages or comments.
3. **State is minimal.** Any page-version tracking is plain JSON and
   inspectable.

**DoD:**
- [ ] Sample output includes at least one page update or clear no-results note.
- [ ] Existing Confluence script fallback is documented.

**Anti-horizontal-phasing check:** The user can skim Confluence changes from the
daily brief without opening Confluence manually.

### Deviation log (after reconciliation)

_Not started._

