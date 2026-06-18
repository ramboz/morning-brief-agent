> Status: Draft (revival baseline)
>
> Decisions the setup and revival pass explicitly deferred. Resolve hard-to-reverse
> choices by writing an ADR and linking it here.

# Refinement Todo: morning-brief-agent

## Architecture

### Decision: Scheduled run mechanism
**Deferred:** The project should run on a schedule, but the final mechanism is not settled.
**Current options:** Codex automations only; a repo-owned CLI scheduler wrapper; or both.
**Resolution trigger:** First spec that implements the scheduled brief shell.

### Decision: Outlook and meeting artifact access
**Deferred:** Outlook email, calendar, Teams transcripts, recap emails, and recording-only links still need a confirmed access path.
**Current options:** M365/Outlook connector if available; Microsoft Graph scripts; browser fallback for unavailable artifacts.
**Resolution trigger:** First spec that revisits Outlook or meeting summaries.

### Decision: Legacy Cowork skill layer
**Deferred:** The repo still has legacy Cowork-style `skills/**` docs, but the revival direction is Codex, jig, MCP tools, and plugins.
**Current options:** Keep as reference; port selected skills into jig/Codex docs; delete once superseded by specs.
**Resolution trigger:** First source-area spec that overlaps an existing legacy skill.

### Decision: Contract artifacts
**Deferred:** The architecture now names CLI output, config, and Markdown digest contracts, but formal schemas are not committed.
**Current options:** Add JSON Schema for script envelopes and config; rely on fixtures for Markdown render contracts; keep prose-only until a contract changes.
**Resolution trigger:** First spec that changes a script envelope, config shape, or Markdown section format.
**Interim note (2026-06-18):** Slice `002-01` changed AI Radar config examples, CLI stats/warnings, and the Markdown footer. Formal contract artifacts remain deferred to spec `008-02`; slice `002-02` is the immediate fixture-backed check for the AI Radar output shape.
**Interim note (2026-06-18):** Slice `002-03` changed the AI Radar action
layer Markdown contract. The checked-in fixtures now cover both an actionable
digest and quiet-day fallback; formal schemas/snapshot automation remain
deferred to spec `008-02`.

## Source Slices

### Decision: Slack plugin versus Slack scripts
**Deferred:** The Slack plugin can handle digest, triage, and native drafts, but legacy Slack scripts still exist.
**Current options:** Plugin-first with scripts as fallback; script-first for reproducibility; hybrid by workflow.
**Resolution trigger:** Slack daily triage spec.

### Decision: GitHub PR review staging policy
**Deferred:** Automatic PR detection is desirable, but staging behavior should be explicit.
**Current options:** Write reviews only to Obsidian/output; create pending GitHub reviews when enabled per repo; require manual trigger for staging.
**Resolution trigger:** GitHub PR review automation spec.

### Resolved: AI Radar source list
**Resolved by:** Spec `002`, slice `002-01`.
**Resolution:** AI Radar v1 keeps a small enabled default source list and leaves broader, static, paper, newsletter, social/trending, and trend-engine examples disabled with explicit `deferred_reason` notes.

## Operations

### Decision: CI/CD setup
**Deferred:** No CI is currently configured.
**Current options:** Stay local-only for now; add a lightweight CI check for fixtures/lint; add CI after the first non-trivial code change.
**Resolution trigger:** First slice that introduces meaningful test automation.

### Decision: Test strategy
**Deferred:** The repo has fixtures but no real package test command.
**Current options:** Fixture snapshot checks for renderers; script smoke tests; targeted unit tests around shared helpers.
**Resolution trigger:** First slice that requires committed test automation beyond fixture snapshots and targeted script checks.
**Interim note (2026-06-18):** Slice `002-01` used a targeted script smoke run because no pytest/vitest/jest runner is configured. Slice `002-02` owns refreshing `tests/fixtures/ai-radar.*` from the real trimmed run.
**Interim note (2026-06-18):** Slice `002-03` changed AI Radar rendering and
used renderer-focused Node checks plus refreshed Markdown/JSON fixtures instead
of introducing a package-level test command. The repo still has no committed
pytest/vitest/jest runner.
