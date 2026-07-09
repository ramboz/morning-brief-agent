---
status: DONE
---

# Spec 006: Meeting Artifact Summaries

## Overview

Improve meeting summary behavior by separating artifact discovery from
summarization. The brief should distinguish text artifacts that can be
summarized from recording-only meetings that need manual review.

Scope and access boundaries are settled by
[ADR-0008](../../decisions/adr-0008-meeting-artifact-pipeline-separation.md)
(Accepted 2026-07-04): discovery covers non-cancelled online meetings with
`responseStatus.response` of `accepted` or `tentativelyAccepted` only
(`declined`/`notResponded` excluded); true attendance is not used as a
filter (Teams attendance reports are not reachable without admin-consent
scopes); externally-organized meetings fall back to MP4/recap-email
discovery since they don't resolve via calendar-based meeting-ID lookup.

## SPIDR analysis

**Axis: Rules.** The core value comes from clearer rules for transcript,
recap-email, and recording-only cases.

## Slices

1. **`006-01 artifact-inventory`** - Discover transcripts, recap emails, and
   recording-only links as separate artifact types.
2. **`006-02 text-summary-pipeline`** - Summarize accessible text artifacts into
   Obsidian meeting notes.
3. **`006-03 recording-only-brief-section`** - Render unavailable transcripts
   and recording-only meetings clearly in the daily brief.

