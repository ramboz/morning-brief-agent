---
status: IN_PROGRESS
---

# Spec 003: Scheduled Brief Shell

## Overview

Create the smallest scheduled/manual brief path that can run source slices,
write Markdown output, and fail independently. The first useful shell can be
AI Radar-only; it should establish the operating pattern for later Slack,
GitHub, Outlook, Jira, and Confluence sections.

## SPIDR analysis

**Axis: Path.** Start with a manual/local brief path, then add scheduler
integration and failure reporting.

## Slices

1. **`003-01 manual-brief-writer`** - Compose the first daily note from
   available source output.
2. **`003-02 codex-automation-proposal`** - Wire or document the Codex
   automation path for scheduled runs.
3. **`003-03 failure-reporting-state`** - Track per-source failures and last
   run metadata without blocking the whole brief.

