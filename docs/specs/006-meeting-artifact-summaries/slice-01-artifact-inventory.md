---
status: READY_FOR_IMPLEMENTATION
dependencies: [adr-0008]
last_verified: 2026-07-04
arch_review: true
---

## Slice 006-01 - artifact-inventory

**Goal:** Return a structured inventory of meeting artifacts before attempting
summarization.

**DoR:**
- [x] Current `scripts/fetch-outlook.js` and `scripts/summarize-meeting.js`
      behavior has been reviewed.
- [x] Graph auth requirements are known.
- [x] ADR-0008 Accepted — invitation scope and access boundaries settled.

**Acceptance Criteria:**

1. **Artifacts are typed.** Transcript files, recap emails, and MP4 recording
   links are represented as distinct artifact types.
2. **Deduplication is explicit.** Multiple hits for the same meeting collapse to
   one meeting record with multiple artifacts.
3. **Unavailable text is visible.** Recording-only cases preserve a watch link
   and explain why summarization cannot happen.
4. **Invitation scope per ADR-0008.** Discovery only considers non-cancelled
   online meetings with `responseStatus.response` of `accepted` or
   `tentativelyAccepted`; `declined` and `notResponded` meetings are excluded
   entirely (never appear in the inventory, not even as skipped entries).
5. **Cross-tenant meetings degrade gracefully.** A meeting organized outside
   the tenant is still inventoried (via title/time-window matching against
   MP4/recap-email search), but without calendar-based meeting-ID resolution,
   consistent with ADR-0008's documented boundary.

**DoD:**
- [ ] Sample inventory output covers at least transcript, recap email, and
      recording-only cases.
- [ ] The script still fails independently when Graph search fails.
- [ ] A fixture/sample demonstrates a declined or notResponded meeting being
      excluded from the inventory.

**Anti-horizontal-phasing check:** The user can see which meetings have notes,
which have recordings, and which need manual attention.

### Deviation log (after reconciliation)

_Not started._

