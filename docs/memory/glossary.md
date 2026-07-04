# Glossary

> Status: Draft (wizard-generated)
>
> Domain terms and project-specific vocabulary for morning-brief-agent. Loaded on demand
> when the hot cache (AGENTS.md) misses. Update via `/jig:memory-sync` or when
> `jig-memory-scan` surfaces an unknown reference.
>
> When `jig-memory-scan` flags an unrecognized capitalized reference, the user
> provides the definition once and `memory-sync` writes it here. High-frequency
> terms (referenced ≥3 times in a session) are promoted to the AGENTS.md hot cache.

<!-- Terms below, alphabetical. Format: ## TERM, followed by definition prose. -->

## Review subagents
User has granted standing permission to run review subagents for jig review, craft, architecture, and reconciliation passes in this project.

## Meeting artifact inventory
The deduplicated, typed inventory produced by scripts/lib/meetings/inventory.js's buildArtifactInventory() (slice 006-01, per ADR-0008): one record per non-cancelled online meeting with responseStatus accepted/tentativelyAccepted, each carrying zero or more typed artifacts (transcript, recording, recap_email) plus derived flags hasSummarizableText/recordingOnly/noArtifactFound. This is the single source of truth for meeting-related rendering — fetch-outlook.js exposes it as data.meetingInventory, summarize-meeting.js builds its own copy for --brief mode, and skills/morning-outlook/SKILL.md renders directly from it (never from raw transcripts/recordings search hits).
