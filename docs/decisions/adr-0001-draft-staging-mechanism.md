# ADR-001: Draft Staging Mechanism Per Tool

**Status:** Accepted
**Date:** 2026-03-19
**Validated by:** Phase 0 spike (Tests 6–8)

---

## Context

The agent's Layer 3 goal is to stage draft responses for the user to review and send manually. During Phase 0 spike testing, we validated browser draft staging across Slack, Outlook, and JIRA. This surfaced a critical difference in how each tool handles unsent content:

- **Slack** and **Outlook** have first-class draft concepts. Content typed into the compose box persists when you navigate away — Slack keeps it in the input field, Outlook auto-saves to the Drafts folder.
- **JIRA** has no draft concept. The comment editor is a transient in-page form. Navigating away from the ticket silently discards any unsaved content.
- **Confluence/Wiki** is read-only in this system (no drafting at all).
- **GitHub** issue comments have the same problem as JIRA — no persistence on navigation. (GitHub PR reviews have a "pending review" concept, but individual comments do not.)

Relying on the browser compose box for JIRA and GitHub is therefore unreliable: the user has no guarantee the draft will be there when they return to the ticket, and the agent cannot verify persistence after the fact.

## Decision

Differentiate the draft staging mechanism by tool based on whether the tool has a reliable draft persistence model:

| Tool | Draft mechanism | Persists? |
|---|---|---|
| Slack | Browser compose box | ✓ Yes — stays in input field |
| Outlook | Browser compose box | ✓ Yes — auto-saved to Drafts folder |
| JIRA | **Local Markdown fragment** | ✓ Yes — written to `drafts/` in vault |
| GitHub | **Local Markdown fragment** | ✓ Yes — written to `drafts/` in vault |
| Confluence | Read-only — no drafting | N/A |

For tools in the **local MD fragment** category, the agent will:

1. Write a file to `{vault}/drafts/YYYY-MM-DD-{tool}-{id}-comment.md`
2. Include the full draft text plus metadata (ticket/PR URL, context summary)
3. Reference the draft in the daily note under a "Staged Drafts" section with a direct link
4. Never open the JIRA/GitHub comment box in the browser

Example filename: `2026-03-19-jira-SITES-38240-comment.md`

Example daily note entry:
```
### Staged Drafts
- [ ] JIRA SITES-38240 — [[2026-03-19-jira-SITES-38240-comment]] · [Open ticket](https://jira.corp.adobe.com/browse/SITES-38240)
- [ ] GitHub PR #1367 — [[2026-03-19-github-pr-1367-review]] · [Open PR](https://git.corp.adobe.com/...)
```

## Consequences

**Positive:**
- Drafts for JIRA and GitHub are guaranteed to persist — no silent data loss
- Simpler implementation: no browser automation needed for JIRA or GitHub comment staging
- User gets a single place (daily note) to see all staged drafts across all tools
- Markdown fragments are easy to review, edit, and copy-paste

**Negative:**
- JIRA and GitHub drafts require an extra copy-paste step vs. Slack/Outlook where the draft is already in the compose box
- Slightly inconsistent UX across tools (two mental models)

**Neutral:**
- This has no impact on the data gathering layer (Layer 2) — only Layer 3 is affected
- Confluence remains read-only regardless of this decision

## Files to update

- `CLAUDE.md` — per-tool access strategy table (Draft column)
- `skills/morning-jira/SKILL.md` — replace browser comment staging with local MD fragment output
- `docs/morning-assistant-v2-vision.md` — update architecture overview table
