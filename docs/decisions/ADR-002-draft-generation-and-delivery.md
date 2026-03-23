# ADR-002: Draft Generation and Delivery Pipeline

**Status:** Accepted
**Date:** 2026-03-23
**Supersedes:** ADR-001 (Slack section only — Slack moves from browser compose to DM-to-self)

---

## Context

ADR-001 established per-tool draft staging mechanisms. After initial implementation of the read-only brief (Phases 1-2, 5-7), we're now designing the draft generation pipeline. Key concerns:

1. **Safety** — The LLM must never accidentally send a message. Browser compose boxes are risky (one wrong click = sent). The user needs a review step with zero send risk.
2. **Context quality** — Drafts need enough context to be "ready to paste." A reply to a Slack thread needs the full thread, not just the mention. A GitHub PR review needs the diff, description, and linked issue.
3. **UX efficiency** — If copy-pasting and adjusting formatting takes longer than just writing the reply, adoption drops to zero. The drafts must be immediately usable.

## Decision

### Delivery mechanism per tool

| Tool | Delivery | Why |
|---|---|---|
| Slack | **DM-to-self** via Slack API | Zero send risk. Already in Slack — no context switch. Formatted correctly for Slack (mrkdwn, mentions, links). One-tap to open the target channel + paste. |
| JIRA | **Local MD fragment** in vault | No draft concept in JIRA. MD file persists, links to ticket. Copy-paste into comment box. |
| GitHub PR reviews | **Pending review** via GitHub API | GitHub's native draft mechanism. Comments stay invisible until user clicks "Submit review." |
| GitHub issues/comments | **Local MD fragment** in vault | No draft persistence. Same pattern as JIRA. |
| Confluence | **Local MD fragment** in vault | Read-only tool, but user may want to draft page comments or inline comments. |
| Outlook | **Deferred** until Phase 3 | MS Graph API may support creating draft emails directly. TBD. |

### Draft generation approach

- **Auto-draft**: The agent generates drafts for every item that looks like it needs a response (mentions asking a question, DMs awaiting reply, review requests, assigned tickets with discussion).
- **Quality target**: Ready to paste with minimal edits. Professional tone matching the user's style. Not a summary — an actual reply.
- **Generator**: The orchestrator (Claude) generates drafts inline during the brief, using enriched context from the gather scripts.

### Context enrichment per tool

| Tool | Context gathered for drafting |
|---|---|
| Slack | Full thread (all replies, not just mention). Last ~20 messages in channel for ambient context. Who's involved and their roles. |
| JIRA | Ticket description, all comments (chronological), linked tickets, current status/assignee. |
| GitHub PR | PR description, diff stat, review comments, linked issues (parsed from "Fix #123" / "Closes #123" patterns). If linked issue is on JIRA (e.g., "SITES-1234"), fetch from JIRA API too. |
| GitHub Issue | Issue body, all comments, labels, assignees. |

### Slack DM-to-self format

Each draft is posted as a single message to the user's own DM channel:

```
💬 *Draft reply for #contextual-exp-team* → <slack-permalink|View original>

> @gillies asked: [summary of what they asked]

---

[Draft reply text, formatted in Slack mrkdwn]

---
_Auto-drafted by Morning Assistant • Review before pasting_
```

### Local MD fragment format

```markdown
---
tool: jira
target: SITES-38240
url: https://jira.corp.adobe.com/browse/SITES-38240
context: "Ravi asked about S2S auth approach for SpaceCat"
generated: 2026-03-23T08:00:00Z
---

[Draft comment text, ready to copy-paste]
```

### Daily note integration

```markdown
## 📊 Staged Drafts
| # | Tool | Target | Draft | Status |
|---|---|---|---|---|
| 1 | Slack | [#contextual-exp-team → @gillies](permalink) | [View in DMs](dm-link) | 📝 Review |
| 2 | JIRA | [SITES-38240](jira-url) | [[2026-03-23-jira-SITES-38240-comment]] | 📝 Review |
| 3 | GitHub | [spacecat-api-service #482](pr-url) | Pending review staged | 📝 Review |
```

## Consequences

**Positive:**
- Zero send risk across all tools (DM-to-self can't be accidentally sent to others)
- Slack drafts are already formatted in mrkdwn — no reformatting needed when pasting
- GitHub PR reviews use the native pending review mechanism — cleanest possible UX
- All drafts surfaced in one place (daily note) with direct links
- No browser automation needed for any draft delivery (API-only or filesystem)

**Negative:**
- Slack DM-to-self adds messages to the user's own DM channel (could feel cluttered)
- Copy-paste step required for JIRA/GitHub issues/Confluence (unavoidable without draft APIs)
- Context enrichment adds API calls and increases brief generation time

**Mitigations:**
- Slack drafts are clearly labeled and can be bulk-deleted after review
- Local MD fragments are date-prefixed and can be auto-cleaned after N days
- Context enrichment is parallelized where possible
