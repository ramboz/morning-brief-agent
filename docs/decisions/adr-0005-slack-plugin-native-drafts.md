---
dependencies: []
last_verified: 2026-07-01
status: Accepted
---

# ADR-0005: Slack plugin native drafts

## Status

Accepted (2026-07-01)

## Context

ADR-0002 chose Slack DM-to-self staging because it was safe and available at
the time. The Slack plugin now provides Slack-specific daily digest,
notification triage, reply drafting, outgoing-message formatting, and native
draft workflows.

Native drafts better match the desired review-first UX: the draft lives in the
source channel, DM, or thread rather than in a self-DM that the user must copy
from.

## Decision Options Considered

### Option A: Keep DM-to-self staging
- **Pros:** Already designed; zero send risk; independent of plugin draft
  support.
- **Cons:** Adds clutter to self-DM and requires a copy/paste step.

### Option B: Use Slack plugin native drafts for review-first flows
- **Pros:** Drafts appear where the reply belongs; plugin skills already handle
  Slack formatting and draft guardrails.
- **Cons:** Depends on plugin availability and cannot overwrite existing
  attached drafts.

### Option C: Send Slack replies directly when confident
- **Pros:** Fastest possible workflow.
- **Cons:** Violates the project's unattended-run safety posture.

## Recommended Decision

Use the Slack plugin as the primary Slack path. For reply workflows, create
native Slack drafts only when draft behavior is explicitly enabled or requested.
Do not send Slack messages from scheduled or unattended brief runs.

If accepted, this supersedes the Slack delivery section of ADR-0002 while
leaving Jira/GitHub/local-fragment decisions intact.

## Consequences

**Becomes easier:**
- Slack reply drafts are closer to the user's actual review/send workflow.
- Slack digest and notification triage can use the plugin's purpose-built
  skills.

**Becomes harder:**
- The workflow must surface plugin coverage limits and draft conflict errors.
- The legacy Slack script boundary needs to be documented.

## Open questions

- Which Slack scopes should be configured for the first daily triage?
- Should Slack drafts be disabled by default until the user approves a scope?

