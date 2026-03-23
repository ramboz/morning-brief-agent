---
name: morning-jira
description: JIRA DC sub-agent — three-step workflow (gather via REST API script, analyze tickets/discussions, stage draft comments as local Markdown fragments). Supports Morning Brief and Deep Dive modes.
allowed-tools: bash
---

# Morning JIRA

## Load config

Read: `~/.claude/skills/morning-jira/config/jira-filters.json`

Extract: `url` (JIRA base URL), `projects` (array of project keys), `lookback_hours_override`.

If config is missing or `projects` is empty, stop:
> JIRA config missing — please create `jira-filters.json` from the example.

---

## Morning Brief Mode

### Step 1 — GATHER (fast)

**gather_method = "script":** Run the helper script:

```bash
node {scripts_path}/fetch-jira.js --brief
```

Parse the JSON output. The script performs the three-pass scan:
1. Assigned tickets with recent activity
2. Tickets where user commented (not assigned)
3. Tickets where user was @mentioned

If the script returns `ok: false`, report the errors and skip JIRA.

**gather_method = "browser" (fallback):** Navigate to JIRA web UI via Claude in Chrome. Check for login. Scan "My Issues", recent activity, notification bell.

### Step 2 — ANALYZE (fast)

Deduplicate by ticket key. Priority order: assigned > commented > mentioned.

Classify each ticket:
- **Needs Your Input** — question directed at user, user is blocked, decision pending
- **Updated / FYI** — activity happened, no action required

**Identify draft targets:** "Needs Your Input" tickets where a comment reply is clearly expected.

### Step 3 — DRAFT (local MD fragment — if draft_enabled)

JIRA has no draft persistence — content typed into the comment box is lost on navigation. Do NOT open the browser for drafting.

For each draft target:

#### 3a. Enrich context

Run: `node {scripts_path}/fetch-jira.js --context <TICKET-KEY>`

This fetches the full ticket with ALL comments (not just the last 3), description, status, assignee, and labels — giving enough context for a quality draft.

#### 3b. Generate draft text

Using the enriched context, write a draft JIRA comment in plain text.

**Draft guidance:**
- Address the specific question in the most recent relevant comment
- Technical recommendation: "My recommendation: X, because Y"
- Need more context: "Looking into this — will update by [today/tomorrow]"
- Status request: write a brief, accurate status update
- Never fabricate technical details

#### 3c. Stage as local MD fragment

Pipe to: `node {scripts_path}/stage-local-draft.js --vault {vault_path}`

Input (JSON on stdin):
```json
{
  "tool": "jira",
  "target": "SITES-38280",
  "url": "https://jira.corp.adobe.com/browse/SITES-38280",
  "title": "Target Offer Management Servlet",
  "context": "Alice asked about token refresh approach",
  "draft": "The draft comment text"
}
```

Writes to: `{vault}/drafts/YYYY-MM-DD-jira-{TICKET-KEY}-comment.md`

**Skip drafting for:** Tickets with no question directed at user; tickets needing info the agent doesn't have.

See: `docs/decisions/ADR-002-draft-generation-and-delivery.md`

### Output

Return to orchestrator:
- Daily note section (formatted markdown)
- Draft targets list

### Daily note section format

```markdown
### Needs Your Input
- 🔴 **[ENG-482](https://jira.co/browse/ENG-482)** In Progress — Alice is blocked on token refresh edge case → [[2026-03-19-jira-ENG-482-comment]]
  *(High · updated 2h ago)*
- 🔴 **[PLAT-89](https://jira.co/browse/PLAT-89)** Blocked — decision needed on staging environment → [[2026-03-19-jira-PLAT-89-comment]]

### Updated / FYI
- ℹ️ **[ENG-501](https://jira.co/browse/ENG-501)** — New subtask: "Add retry logic to webhook handler"

### Staged Drafts (2)
- [ ] [[2026-03-19-jira-ENG-482-comment]] → [Open ticket](https://jira.co/browse/ENG-482)
- [ ] [[2026-03-19-jira-PLAT-89-comment]] → [Open ticket](https://jira.co/browse/PLAT-89)
```

---

## Deep Dive Mode

Answer the user's question about JIRA. No draft staging unless asked.

**gather_method = "script":** Run `node {scripts_path}/fetch-jira.js --search "query terms"`
**gather_method = "browser":** Navigate to JIRA search, enter JQL or keywords.

Return a direct, conversational answer with ticket keys, summaries, and context.

---

## Error handling

| Scenario | Action |
|---|---|
| Script returns `ok: false` | Report errors, skip JIRA |
| Login screen (browser) | Stop, report "JIRA requires login" |
| Network / page won't load | Report "JIRA unreachable — check VPN?" |
| Comment textarea not found | Skip draft, log, continue |
| No tickets found | Report "Nothing to report." — not an error |
