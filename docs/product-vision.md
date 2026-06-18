> Status: Draft (revival baseline)
>
> Captures why this project exists, for whom, and with what principles.
> Architectural mechanics live in [architecture.md](architecture.md).
> Update via reconciliation, or via `/jig:vision-elicitation`.

# Vision: morning-brief-agent

## Identity

<!-- elicited: 2026-06-18 / status: filled -->

- **Vision statement:** Morning Assistant v2 is a personal Markdown-first intelligence layer that scans work tools, produces a structured Daily Brief in Obsidian, and prepares safe review-first follow-ups.
- **Tagline** *(optional)*: Morning Assistant (noun): a daily operating brief for one person who lives across Slack, GitHub, Jira, Confluence, Outlook, meetings, and fast-moving AI tooling.
- **Positioning story** *(optional)*: The project is being revived from an older Cowork/Claude-in-Chrome plan into a jig-managed, Codex/MCP-first workflow. Helper scripts remain useful, but connectors and MCP tools should simplify source integrations where they exist.

## Target users

<!-- elicited: 2026-06-18 / status: filled -->

- **For:**
  - A single engineering manager / frontier engineer who wants a daily readout across work tools.
  - A personal Obsidian user who prefers inspectable Markdown over a dashboard UI.
  - A builder of agent workflows who wants small, reproducible vertical slices rather than a large platform rewrite.
  - A reviewer who wants automatic surfacing of GitHub PRs that need attention, with draft review help.
- **Not for:**
  - A team-wide shared assistant with multi-user permissions and admin workflows.
  - A production SaaS product, dashboard, or web app.
  - Broad news aggregation, newsletter ingestion, or multi-week trend analysis.

## Core problem

<!-- elicited: 2026-06-18 / status: filled -->

- **Problem:** Work context is scattered across Slack, Outlook, GitHub, Jira, Confluence, meeting transcripts, and AI/tooling news. The daily cost is not just reading each source; it is deciding what matters, what needs a reply, and what action should happen next.
- **Today's paths and where they fall short:**
  - Manually checking each tool is reliable but slow, repetitive, and easy to derail.
  - Pure browser automation can stage drafts, but it is slower and more fragile than API or MCP reads.
  - Pure CLI/API scripts are fast and inspectable, but they do not always deliver the review-first workflow that makes follow-up work easy.
- **Originating incident / audit** *(optional)*: The older v2 plan identified the right shape - fast data gathering plus targeted draft staging - but it over-weighted browser/Cowork assumptions. The revival should simplify around today's Codex, jig, MCP tools, and installed plugins.

## Competitive landscape

<!-- elicited: 2026-06-18 / status: filled -->

| Option | What it does | Where it falls short for this gap |
|---|---|---|
| Manual morning routine | Full human judgment across all tools | Takes too long and repeats the same scanning work every day |
| Individual tool notifications | Shows unread items where they live | Does not synthesize across tools or answer "what should I do?" |
| Pure browser agent | Can interact with most web UIs | Slow for read-heavy work and fragile around custom editors |
| Pure script / CLI assistant | Fast, diffable, and easy to debug | Needs explicit integration work for review-first drafts and scheduling |
| Enterprise copilots | Useful inside one suite or vendor boundary | Usually not personal, Obsidian-first, or cross-tool enough |

**Where this project fits:** Morning Assistant is a personal, local, Markdown-first operating layer that uses MCP/plugins/scripts pragmatically and keeps the human in charge of sending, merging, posting, or changing state.

## Scope

<!-- elicited: 2026-06-18 / status: filled -->

### Core features (prioritized)

1. AI Radar: curated AI/tooling sources, relevance triage, explicit action layer, Obsidian Markdown, fixture from a real run.
2. Scheduled brief shell: run on a schedule, collect available source sections, write a daily note, and report failures without blocking the whole brief.
3. Slack plugin triage: use the installed Slack plugin for daily digest, notification triage, and optional native Slack drafts.
4. GitHub PR review automation: detect review-requested PRs, run the `pr-review` skill, and write or stage review drafts.
5. Meeting artifact summaries: find transcripts, recap emails, or recording-only links; summarize accessible text; make unavailable transcripts explicit.
6. Jira, Confluence, and corporate GitHub source slices: prefer MCP tools where available; keep existing scripts as fallbacks.
7. Deep Dive mode: on-demand cross-tool synthesis after the daily brief slices are useful.

### Tiers / phases *(optional)*

- **Revival baseline:** jig scaffold, product/architecture docs, first real spec.
- **MVP:** AI Radar plus scheduled Markdown brief shell.
- **Work-tool slices:** Slack, GitHub PR reviews, Outlook/meetings, Jira, Confluence.
- **Polish:** parallelism, better state, cleanup, and connector upgrades.

### MVP scope

- AI Radar v1 with a small curated source list.
- A reproducible fixture and generated Markdown digest.
- A scheduled or manually runnable path that writes inspectable output.
- Explicit "what should I do?" content, not just summaries.

### Out of scope (deliberately)

- No UI.
- No shared multi-user deployment.
- No broad source catalog.
- No Hugging Face papers in AI Radar v1.
- No manual newsletter ingestion in AI Radar v1.
- No multi-week trend engine.
- No premature shared abstractions.
- No automatic sends, merges, posts, wiki edits, or Jira status changes.

## Stack

<!-- elicited: 2026-06-18 / status: filled -->

- **Runtime / language:** Node.js 20+, native ESM, plain JavaScript with JSDoc where helpful.
- **Platform commitments:**
  - Local-first repo with scripts run directly through `node`.
  - Codex as the current development and automation surface.
  - jig for specs, workflow, review evidence, and project memory.
  - Obsidian as the primary output surface.
  - MCP tools and Codex plugins preferred when available.
  - Helper scripts for source areas without reliable MCP/plugin coverage.
- **Locked-in vs. still open:**
  - Locked in: Markdown-first output, script-first implementation, no web UI, no database for v1, review-first safety constraints.
  - Open: final scheduler shape, Outlook/M365 integration path, meeting transcript availability strategy, and which legacy Cowork skills remain useful.

## Design principles & constraints

<!-- elicited: 2026-06-18 / status: filled -->

1. Ship vertical slices, one source area at a time.
2. Prefer useful daily output over platform completeness.
3. Keep modules small, plain, inspectable, and diffable.
4. Fail independently and degrade gracefully.
5. Prefer MCP/plugins over custom API logic when the tool coverage is good.
6. Keep the user in control of irreversible actions.
7. Preserve the repo's simple script-first style.

**Non-obvious constraints:** This is a personal tool, not a product. It should bias toward local files, readable JSON, Markdown fixtures, and clear failure notes. It should never send messages, permanently delete emails, edit Confluence pages, merge PRs, push code, or change Jira ticket status.

## How new work enters

<!-- elicited: 2026-06-18 / status: filled -->

- **Prioritization model:** Signal-driven and slice-driven. A source area moves up when it can produce a small end-to-end result that is useful enough to read daily.
- **Spec-triggering rules:**
  - Create a spec when a change affects workflow, source boundaries, scheduling, data contracts, or user-facing brief output.
  - Keep quick one-off fixes outside the full spec loop when they are genuinely small.
  - Treat legacy `specs/` files as reference inputs until a jig spec deliberately migrates or supersedes them.
  - Promote hard-to-reverse choices into ADRs under `docs/decisions/`.

## Open questions

<!-- elicited: 2026-06-18 / status: filled -->

- Should scheduled runs be Codex automations only, or should the repo keep a CLI scheduler wrapper too?
- Which legacy Cowork skills should be retired, kept as reference, or ported into Codex/jig docs?
- What is the right Outlook/M365 path for email and meeting artifacts?
- Should GitHub PR reviews be written only to Obsidian first, or also staged as pending GitHub reviews when explicitly enabled?
- How much Slack behavior should rely on the Slack plugin versus existing scripts?
