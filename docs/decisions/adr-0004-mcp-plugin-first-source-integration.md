---
dependencies: []
last_verified: 2026-06-18
---

# ADR-0004: MCP and plugin first source integration

## Status

Proposed (2026-06-18)

## Context

The old architecture used lightweight Node scripts and Cowork skills for data
gathering. The current Codex environment exposes MCP tools for Jira,
Confluence/wiki, corporate GitHub, and the Slack plugin now provides Slack
digest, triage, and draft workflows.

Custom scripts remain useful for AI Radar, Outlook/meeting Graph access, and
fallback/debug paths, but keeping script-first logic for every source would
duplicate connector capabilities and increase maintenance.

## Decision Options Considered

### Option A: Keep all source areas script-first
- **Pros:** Reproducible, local, easy to inspect, no dependency on active plugin
  tool surfaces.
- **Cons:** Duplicates MCP/plugin features and leaves the project doing more
  auth/API plumbing than necessary.

### Option B: Prefer MCP/plugins, keep scripts as fallbacks
- **Pros:** Simplifies source slices where tools are already available while
  preserving the repo's inspectable script-first debugging style.
- **Cons:** Requires each source spec to define coverage limits and fallback
  behavior.

### Option C: Remove scripts once connectors exist
- **Pros:** Smaller codebase.
- **Cons:** Loses fixtures, offline debugging, and fallback paths too early.

## Recommended Decision

Prefer MCP tools and Codex plugins for source integrations when they provide
the needed read/draft surface. Keep existing scripts as fallbacks, fixtures, or
source-specific implementations where no reliable connector exists.

## Consequences

**Becomes easier:**
- Slack, Jira, Confluence, and corporate GitHub can be implemented as thinner
  vertical slices.
- The project can use richer tool-native context without expanding custom API
  clients.

**Becomes harder:**
- Source specs must document plugin coverage and graceful fallback behavior.
- Scheduled jobs need to handle connector availability explicitly.

## Open questions

- Which source areas should still produce script fixtures after MCP migration?
- How should scheduled automations authenticate against plugin-only tools?

