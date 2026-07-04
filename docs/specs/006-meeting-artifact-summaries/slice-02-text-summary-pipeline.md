---
status: READY_FOR_IMPLEMENTATION
dependencies: ["006-01"]
last_verified: 2026-06-18
---

## Slice 006-02 - text-summary-pipeline

**Goal:** Summarize accessible transcript or recap-email text into Obsidian
meeting notes without entangling discovery logic.

**DoR:**
- [ ] Slice 006-01 produces typed text artifacts.
- [ ] Meeting note frontmatter and destination path are defined.

**Acceptance Criteria:**

1. **Summaries consume typed artifacts.** The summarizer receives transcript or
   recap-email content plus metadata, not raw search results.
2. **Existing notes are not duplicated.** Dedup checks use meeting identity and
   note filename where possible.
3. **Notes include actions.** Meeting notes include summary, attendees, and
   action items.

**DoD:**
- [ ] At least one dry-run or fixture summary demonstrates the output.
- [ ] Long transcripts are truncated deliberately with a visible note.

**Anti-horizontal-phasing check:** A newly accessible transcript or recap email
turns into a readable Obsidian meeting note.

### Deviation log (after reconciliation)

_Not started._

