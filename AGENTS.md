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

## Jig Workflow
- Use `docs/specs/README.md` as the active jig status board.
- Put new work under `docs/specs/NNN-<slug>/` with vertical slices.
- Keep legacy `specs/` as historical/reference material until a slice deliberately migrates it.
- Use `docs/refinement-todo.md` for deferred questions and resolve hard-to-reverse choices with ADRs in `docs/decisions/`.
- Preserve the spec lifecycle in `docs/workflow.md`: DRAFT -> READY_FOR_REVIEW -> READY_FOR_IMPLEMENTATION -> IN_PROGRESS -> REVIEWED -> RECONCILED -> DONE.

## Hot Cache

Frequently referenced terms and current project state. Update this section when the working context changes.

### Project codenames / active work
- **Morning Assistant v2** - personal Markdown-first intelligence layer for Obsidian.
- **AI Radar** - first revival slice; fetches curated AI/tooling signals, triages them, and renders an Obsidian-ready digest.

### Key terms
- **Daily Brief** - scheduled or manual digest written to Obsidian.
- **Deep Dive** - on-demand cross-tool synthesis mode.
- **MCP tools** - preferred integration path when available; helper scripts remain fallbacks.

### Active specs
- See `docs/specs/README.md`.

### Deferred decisions
- See `docs/refinement-todo.md`.

## Key Documents
- `docs/product-vision.md` - product vision slots and project framing.
- `docs/workflow.md` - jig lifecycle and session workflow.
- `docs/architecture.md` - architecture slots and module boundaries.
- `docs/conventions.md` - coding and authoring conventions.
- `docs/specs/README.md` - active spec status board.
- `docs/refinement-todo.md` - deferred decisions.
- `docs/memory/glossary.md` - durable domain terms.
- `docs/inbox.md` - parked ideas.

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
