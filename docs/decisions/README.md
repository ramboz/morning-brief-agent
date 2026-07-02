# Decisions

> Status: Draft (wizard-generated)
>
> Architectural Decision Records for morning-brief-agent. Nygard convention: immutable
> after acceptance. New decisions supersede old ones — never edit an accepted ADR.

## Index

- [ADR-0001: Draft Staging Mechanism Per Tool](adr-0001-draft-staging-mechanism.md) — Differentiate draft staging per tool by whether the tool has reliable draft persistence (browser compose for Slack/Outlook; local Markdown fragments for JIRA/GitHub). (2026-03-19, Accepted)
- [ADR-0002: Draft Generation and Delivery Pipeline](adr-0002-draft-generation-and-delivery.md) — Per-tool draft generation and delivery with zero send risk; supersedes ADR-0001's Slack section (Slack later superseded by ADR-0005). (2026-03-23, Accepted)
- [ADR-0003: Codex and jig as the spec-driven workflow](adr-0003-codex-jig-sdd-workflow.md) — Morning Assistant v2 is being revived from a back-burner project with legacy Cowork-era docs, helper scripts, and source-area specs. (2026-06-18, Proposed)
- [ADR-0004: MCP and plugin first source integration](adr-0004-mcp-plugin-first-source-integration.md) — The old architecture used lightweight Node scripts and Cowork skills for data gathering. (2026-06-18, Accepted 2026-07-02 — realized by spec 007)
- [ADR-0005: Slack plugin native drafts](adr-0005-slack-plugin-native-drafts.md) — ADR-0002 chose Slack DM-to-self staging because it was safe and available at the time. (2026-07-01, Accepted)
- [ADR-0006: Codex automations for scheduled runs](adr-0006-codex-automations-for-scheduled-runs.md) — Morning Assistant should run on a schedule. (2026-06-19, Accepted)
- [ADR-0007: Review-first GitHub PR automation](adr-0007-review-first-github-pr-automation.md) — The user wants the project to automatically run the PR review skill for GitHub PRs they are asked to review, probably detectable through GitHub notifications. (2026-06-18, Proposed)
- [ADR-0008: Meeting artifact pipeline separation](adr-0008-meeting-artifact-pipeline-separation.md) — The current meeting scripts search Graph for transcripts, recap emails, and recordings, then summarize accessible text into Obsidian notes. (2026-06-18, Proposed)

> **Note on ADR-0001 / ADR-0002 (pre-jig records).** Their filenames are now
> canonical (`adr-000N-<slug>.md`), so they sort and link like every other
> ADR. Their bodies deliberately retain the original three-digit `# ADR-001` /
> `# ADR-002` heading and `**Status:**` / `**Date:**` prose format — they are
> accepted history and were not reformatted (spec 008-01 normalized filenames
> and links only). This index is maintained by hand for these two entries
> because `adr.py index` only parses the canonical `## Status` section shape.

## Format

Each ADR lives at `docs/decisions/adr-NNNN-<slug>.md`. Title: `# ADR-NNNN: <Title>`.

Required sections: Status, Context, Decision Options Considered, Recommended Decision, Consequences.

## When to write an ADR

- Hard-to-reverse decisions
- Decisions that affect multiple modules or the public API
- When a contract changes in a breaking way
- When the `architect` subagent produces a proposal that is accepted
