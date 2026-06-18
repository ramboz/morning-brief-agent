---
dependencies: []
last_verified: 2026-06-18
---

# ADR-0008: Meeting artifact pipeline separation

## Status

Proposed (2026-06-18)

## Context

The current meeting scripts search Graph for transcripts, recap emails, and
recordings, then summarize accessible text into Obsidian notes. Transcript
availability is uneven: organizer-owned VTT files may be inaccessible, recap
emails may arrive later, and recording-only links may be the only artifact.

Combining discovery, download, summarization, and note writing makes it harder
to explain what happened when a meeting cannot be summarized.

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

## Consequences

**Becomes easier:**
- The brief can accurately say "recording available, transcript unavailable."
- Recap emails and transcripts can share a summarization path.

**Becomes harder:**
- The scripts need a clearer intermediate shape and deduplication rules.
- Tests or fixtures need to cover multiple artifact types.

## Open questions

- What fields define meeting identity for deduplication?
- Should recording-only items create Obsidian notes or remain brief-only?
