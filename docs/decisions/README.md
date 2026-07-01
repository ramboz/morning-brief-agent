# Decisions

> Status: Draft (wizard-generated)
>
> Architectural Decision Records for morning-brief-agent. Nygard convention: immutable
> after acceptance. New decisions supersede old ones — never edit an accepted ADR.

## Index

- [ADR-0003: Codex and jig as the spec-driven workflow](adr-0003-codex-jig-sdd-workflow.md) — Morning Assistant v2 is being revived from a back-burner project with legacy Cowork-era docs, helper scripts, and source-area specs. (2026-06-18, Proposed)
- [ADR-0004: MCP and plugin first source integration](adr-0004-mcp-plugin-first-source-integration.md) — The old architecture used lightweight Node scripts and Cowork skills for data gathering. (2026-06-18, Proposed)
- [ADR-0005: Slack plugin native drafts](adr-0005-slack-plugin-native-drafts.md) — ADR-0002 chose Slack DM-to-self staging because it was safe and available at the time. (2026-07-01, Accepted)
- [ADR-0006: Codex automations for scheduled runs](adr-0006-codex-automations-for-scheduled-runs.md) — Morning Assistant should run on a schedule. (2026-06-19, Accepted)
- [ADR-0007: Review-first GitHub PR automation](adr-0007-review-first-github-pr-automation.md) — The user wants the project to automatically run the PR review skill for GitHub PRs they are asked to review, probably detectable through GitHub notifications. (2026-06-18, Proposed)
- [ADR-0008: Meeting artifact pipeline separation](adr-0008-meeting-artifact-pipeline-separation.md) — The current meeting scripts search Graph for transcripts, recap emails, and recordings, then summarize accessible text into Obsidian notes. (2026-06-18, Proposed)

## Legacy accepted records

These pre-jig ADRs remain accepted history. Spec
[008-legacy-docs-contract-cleanup](../specs/008-legacy-docs-contract-cleanup/spec.md)
tracks canonical filename normalization.

- [ADR-001: Draft Staging Mechanism Per Tool](ADR-001-draft-staging-mechanism.md) — accepted 2026-03-19.
- [ADR-002: Draft Generation and Delivery Pipeline](ADR-002-draft-generation-and-delivery.md) — accepted 2026-03-23; supersedes the Slack section of ADR-001.

## Format

Each ADR lives at `docs/decisions/adr-NNNN-<slug>.md`. Title: `# ADR-NNNN: <Title>`.

Required sections: Status, Context, Decision Options Considered, Recommended Decision, Consequences.

## When to write an ADR

- Hard-to-reverse decisions
- Decisions that affect multiple modules or the public API
- When a contract changes in a breaking way
- When the `architect` subagent produces a proposal that is accepted
