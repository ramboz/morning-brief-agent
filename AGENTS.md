# AGENTS.md

## Project
AI Radar is part of Morning Assistant v2, a personal Markdown-first intelligence layer for Obsidian.

## Goal
Ship useful vertical slices, one source area at a time.

Each slice should:
- fetch a small set of high-signal inputs,
- triage them against personal context,
- render concise Markdown for Obsidian,
- include an explicit "what should I do?" layer,
- stay easy to inspect, diff, and extend.

## Delivery Approach
- Prefer vertical slices over horizontal platform work.
- Build the smallest end-to-end version that is genuinely useful.
- Treat each source area as its own slice with real output, not scaffolding.
- Preserve the repo's simple script-first style.

## Current Slice Priority
1. AI Radar
2. Slack
3. Outlook
4. JIRA
5. Confluence
6. GitHub

## AI Radar v1 Scope
- Personal use only
- Small curated source list
- Claude triage with a safe fallback
- Markdown digest for Obsidian
- Explicit action/decision section
- Reproducible fixture from a real run

## Non-Goals For AI Radar v1
- No Hugging Face papers
- No manual newsletter ingestion
- No broad source catalog
- No multi-week trend engine
- No UI
- No premature shared abstractions

## Working Rules
- Prefer clarity over cleverness.
- Keep modules small and plain.
- Fail independently and degrade gracefully.
- If something is ambiguous, choose the smallest reasonable assumption and continue.

## Definition Of Done
A slice is done when:
- the fetch runs end-to-end,
- triage returns structured output,
- Markdown digest output is generated,
- a fixture can be saved from a real run,
- the result is useful enough to read daily.
