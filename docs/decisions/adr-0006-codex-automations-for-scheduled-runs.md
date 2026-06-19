---
dependencies: []
last_verified: 2026-06-18
---

# ADR-0006: Codex automations for scheduled runs

## Status

Accepted (2026-06-19)

## Context

Morning Assistant should run on a schedule. The old plan mentioned external
scheduled tasks and Cowork scheduled skills. The current Codex app exposes a
native automation tool for recurring workspace jobs and thread heartbeats.

The project still needs manual/debug entry points, but the scheduler itself
does not need to be implemented as a custom runtime if Codex automations can
run the brief reliably.

## Decision Options Considered

### Option A: Use Codex automations as the scheduler
- **Pros:** Native to the current development environment; avoids adding cron
  wrappers or daemon code to a personal project.
- **Cons:** Ties scheduling to Codex availability and automation semantics.

### Option B: Add a repo-owned CLI scheduler wrapper
- **Pros:** Portable outside Codex; easy to run from cron or launchd.
- **Cons:** Adds operational code before the brief shell has proven value.

### Option C: Support both immediately
- **Pros:** Flexible.
- **Cons:** More surface area and more failure modes for v1.

## Recommended Decision

Use Codex automations as the default scheduled-run mechanism for the revived
project. Keep the brief runner manually invokable for debugging and future
portability.

## Consequences

**Becomes easier:**
- The scheduled brief can be configured without adding a service process.
- Failures can be reported through Codex run output.

**Becomes harder:**
- The automation prompt must be self-contained and explicit about output and
  safety constraints.
- Plugin/MCP authentication behavior during scheduled jobs must be verified.

## Open questions

- The initial Codex automation proposal uses a weekday morning schedule; the
  user can adjust the time before approving the automation.
- Failed runs should report clearly in the automation result. Writing failure
  state into the Daily Brief itself is deferred to spec `003-03`.
