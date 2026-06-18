---
status: DRAFT
dependencies: []
last_verified: 2026-06-18
arch_review: true
---

## Slice 006-01 - artifact-inventory

**Goal:** Return a structured inventory of meeting artifacts before attempting
summarization.

**DoR:**
- [ ] Current `scripts/fetch-outlook.js` and `scripts/summarize-meeting.js`
      behavior has been reviewed.
- [ ] Graph auth requirements are known.

**Acceptance Criteria:**

1. **Artifacts are typed.** Transcript files, recap emails, and MP4 recording
   links are represented as distinct artifact types.
2. **Deduplication is explicit.** Multiple hits for the same meeting collapse to
   one meeting record with multiple artifacts.
3. **Unavailable text is visible.** Recording-only cases preserve a watch link
   and explain why summarization cannot happen.

**DoD:**
- [ ] Sample inventory output covers at least transcript, recap email, and
      recording-only cases.
- [ ] The script still fails independently when Graph search fails.

**Anti-horizontal-phasing check:** The user can see which meetings have notes,
which have recordings, and which need manual attention.

### Deviation log (after reconciliation)

_Not started._

