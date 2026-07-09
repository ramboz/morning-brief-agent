---
dependencies: []
last_verified: 2026-07-04
status: Accepted
---

# ADR-0008: Meeting artifact pipeline separation

## Status

Accepted (2026-07-04)

## Context

The current meeting scripts search Graph for transcripts, recap emails, and
recordings, then summarize accessible text into Obsidian notes. Transcript
availability is uneven: organizer-owned VTT files may be inaccessible, recap
emails may arrive later, and recording-only links may be the only artifact.

Combining discovery, download, summarization, and note writing makes it harder
to explain what happened when a meeting cannot be summarized.

**Spike findings (2026-07-04):** A live probe against Microsoft Graph
confirmed the access boundaries above and settled the invitation-scope
question. `responseStatus` (`accepted` / `tentativelyAccepted` / `declined` /
`notResponded`) is available today by adding it to the existing
`calendarView` `$select` — no new permissions needed. Teams attendance
reports (`/me/onlineMeetings/{id}/attendanceReports`) returned 403 Forbidden
for every meeting tested, including ones the calling user did not organize;
reaching them would require `OnlineMeetingArtifact.Read.All` with tenant
admin consent, which is not worth pursuing for a personal tool. Cross-tenant
meetings (e.g. a customer-organized meeting in the sample) also 403 on the
basic `onlineMeetings` lookup, so calendar-based meeting-ID resolution only
works for internally-organized meetings — externally-organized meetings must
rely on the other artifact fallbacks (MP4 search, recap email).

## Decision Options Considered

### Option A: Keep the current combined meeting script
- **Pros:** Already works for some cases; fewer files and concepts.
- **Cons:** Harder to represent recording-only meetings and late recap emails
  clearly.

### Option B: Separate artifact discovery from summarization
- **Pros:** Makes transcript, recap-email, and recording-only cases explicit;
  improves daily brief reporting.
- **Cons:** Requires a small intermediate data shape and migration of existing
  meeting logic.

### Option C: Defer meeting summaries entirely
- **Pros:** Avoids Graph complexity during AI Radar/Slack revival.
- **Cons:** Leaves a high-value source area unresolved.

## Recommended Decision

Separate meeting artifact discovery from summarization. Discovery should return
typed artifacts; summarization should consume only accessible text artifacts;
the daily brief should render recording-only meetings as manual-watch items.

Discovery treats a meeting as in-scope when it is a non-cancelled online
meeting with `responseStatus.response` of `accepted` or `tentativelyAccepted`;
`declined` and `notResponded` are out of scope. True attendance is not used
as a filter, since it isn't reliably obtainable (see spike findings above).

## Consequences

**Becomes easier:**
- The brief can accurately say "recording available, transcript unavailable."
- Recap emails and transcripts can share a summarization path.
- Invitation scope is decidable purely from calendar data (`responseStatus`)
  without needing attendance-report access.

**Becomes harder:**
- The scripts need a clearer intermediate shape and deduplication rules.
- Tests or fixtures need to cover multiple artifact types.

## Open questions

- What fields define meeting identity for deduplication?
- Should recording-only items create Obsidian notes or remain brief-only?

**Resolved by spike (2026-07-04):**
- Invitation scope for discovery: `responseStatus.response` in `accepted` or
  `tentativelyAccepted`; `declined` and `notResponded` are excluded (user
  decision, confirmed after the spike).
- True attendance is not used as a signal — Teams attendance reports are not
  reachable without admin-consent scopes this project won't pursue.
- Externally-organized (cross-tenant) meetings can't be resolved to an
  `onlineMeeting` id via the calling user's calendar; they stay on the
  MP4/recap-email fallback path, same as before.
