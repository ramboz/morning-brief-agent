---
name: morning-jira
description: JIRA sub-agent — MCP-first workflow (gather via Jira MCP issue search/read, analyze tickets/discussions, stage draft comments as local Markdown fragments). Falls back to scripts/fetch-jira.js, then browser. Supports Morning Brief and Deep Dive modes.
allowed-tools: bash, computer
---

# Morning JIRA

Per [ADR-0004](../../docs/decisions/adr-0004-mcp-plugin-first-source-integration.md)
and [spec 007](../../docs/specs/007-mcp-source-migration/spec.md), the Jira MCP
tools available in the running session are the primary path for gather +
context enrichment. `scripts/fetch-jira.js` is the fallback interface, and
browser navigation is the last resort — see the fallback-scope note in Step 1
and `docs/architecture.md`'s "Jira: MCP-First With Bounded Fallbacks" for the
full boundary (slice 007-01).

This skill runs in an interactive session because the Jira MCP tools require
one — it is not wired into the headless `scripts/write-brief.js` composer. See
"Legacy Cowork skill layer" in
[docs/refinement-todo.md](../../docs/refinement-todo.md) for why these two stay
separate for now.

## Load config

Read: `{scripts_path}/../config/jira.json` — `{scripts_path}` is the repo's
`scripts/` directory (provided via `config/main.json`), so this path resolves to
the **project-root `config/jira.json`**, the same file the fallback loader
`scripts/lib/config.js` reads. It is not under `skills/`.

Extract: `url` (JIRA base URL), `projects` (array of project keys — the
explicit, user-provided scope), `lookback_hours_override`, and `draft_enabled`
(the Step 3 draft gate — default `false` when absent; see Step 3). This workflow
never claims instance-wide Jira coverage — only `projects` is ever scanned.

If config is missing or `projects` is empty, stop:
> JIRA config missing — please create `jira.json` from `jira.example.json`.

---

## Morning Brief Mode

### Step 1 — GATHER (fast)

**Primary — Jira MCP tools:** Use the Jira MCP tools available in the running
session (referenced here by capability, since exact tool identifiers vary by
session). Run the same three-pass scan the project has always used, scoped to
the configured `projects` and the lookback window:

1. **Issue search — assigned:** tickets assigned to the current user with
   activity updated within the lookback window (`assignee = currentUser()`).
2. **Issue search — commented:** tickets the current user commented on but is
   not assigned to, updated within the lookback window.
3. **Issue search — mentioned:** tickets that mention the current user in text
   (summary, description, or comments), updated within the lookback window,
   not assigned to the user.

For any ticket that needs its full comment thread (Step 3 enrichment), use the
MCP **issue read** capability to pull the complete ticket — description,
status, assignee, labels, and all comments (not just the most recent few).

**If the plugin is unavailable:** fall back to
`node {scripts_path}/fetch-jira.js --brief` (parse the JSON envelope), then to
browser navigation (the JIRA web UI via Claude in Chrome — check for login,
scan "My Issues", recent activity, and the notification bell) as a last resort.
**Note which path was used in the output — never silently substitute one for
another.**

**Fallback scope matches the primary path (slice 007-01) — note in Coverage
when the script fallback is used:** `fetch-jira.js --brief` runs the same
three-pass JQL scan (assigned / commented / mentioned) over the same
`projects` scope and emits the standard envelope
`{ok, tool, mode, timestamp, data, errors}`. If it returns `ok: false`, report
the `errors` and mark Jira **unavailable** for this run (see Error handling) —
do not fail silently. The local-MD draft path (Step 3) does not depend on the
MCP tools, so it still runs after a script-fallback gather as long as
`draft_enabled` is set; note in Coverage which gather path ran.

**Track coverage as you go**, per configured project — three possible states:
- **quiet** — scanned, zero matching tickets in the lookback window.
- **active outside window** — has activity, but it falls just outside the
  lookback window (say so rather than lumping it in with quiet).
- **unreachable** — couldn't scan this project this run (auth/scope error).

This feeds the Coverage note in Step 2/Output. Do not expand scope beyond
`projects` to compensate for a quiet or unreachable entry.

### Step 2 — ANALYZE (fast)

Deduplicate by ticket key. Priority order: assigned > commented > mentioned.

Classify each ticket:
- **Needs Your Input** — question directed at user, user is blocked, decision
  pending. Priority: high.
- **Updated / FYI** — activity happened, no action required.

**Filter out:** the user's own routine status updates and automated bot
comments (unless incident/alert-related).

**Identify draft targets:** "Needs Your Input" tickets where a comment reply is
clearly expected (a direct question addressed to the user, an awaited
decision).

**Coverage note (required, per AC1):** report all three states tracked in
Step 1 — quiet, active-outside-window, unreachable — rather than omitting any
silently, and name which gather path ran (MCP / script / browser). A short
line per state is enough. Never imply full instance coverage.

### Step 3 — DRAFT (local MD fragment — only if `draft_enabled: true`)

JIRA has no draft persistence — content typed into the comment box is lost on
navigation. **Do NOT open the browser for drafting**, and never use any MCP
comment-add / transition capability to write into Jira directly.

**Skip this entire step unless `config/jira.json`'s `draft_enabled` is exactly
`true`.** Default is `false` — never draft without explicit opt-in. If the
field is missing, `false`, or anything other than the literal boolean `true`,
do not stage any draft this run.

For each draft target identified in Step 2:

#### 3a. Enrich context

**Primary — Jira MCP tools:** use the **issue read** capability to fetch the
full ticket with ALL comments (not just the last few), description, status,
assignee, and labels — enough context for a quality draft.

**Fallback:** `node {scripts_path}/fetch-jira.js --context <TICKET-KEY>`
returns the same enriched context in the standard envelope.

#### 3b. Generate draft text

Using the enriched context, write a draft JIRA comment in plain text.

**Draft guidance:**
- Address the specific question in the most recent relevant comment.
- Technical recommendation: "My recommendation: X, because Y".
- Need more context: "Looking into this — will update by [today/tomorrow]".
- Status request: write a brief, accurate status update.
- Never fabricate technical details or decisions.

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

**Skip drafting for:** tickets with no question directed at the user; tickets
needing info the agent doesn't have.

See: [ADR-002](../../docs/decisions/adr-0002-draft-generation-and-delivery.md)
(the local-MD fragment mechanism for JIRA/GitHub comments is unchanged by the
MCP migration).

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
_(only shown when `draft_enabled: true`)_
- [ ] [[2026-03-19-jira-ENG-482-comment]] → [Open ticket](https://jira.co/browse/ENG-482)
- [ ] [[2026-03-19-jira-PLAT-89-comment]] → [Open ticket](https://jira.co/browse/PLAT-89)

### Coverage
_Gathered via Jira MCP tools. Quiet this run: OPS, INFRA. No projects unreachable._
```

**Self-check before returning:** every ticket key links to its `browse/`
URL; every "Needs Your Input" item says why it matters and whether a reply is
expected; there is a Coverage line naming the gather path and per-project
state. If not, fix it before returning to the orchestrator.

---

## Deep Dive Mode

Answer the user's question about JIRA. No draft staging unless asked.

**Primary — Jira MCP tools:** use the **issue search** capability with the
user's keywords (and any date/project modifiers), scoped to `projects` unless
the user explicitly asks to search wider.
**Fallback — script:** run `node {scripts_path}/fetch-jira.js --search "query terms"`.
**Fallback — browser:** navigate to JIRA search, enter JQL or keywords.

Return a direct, conversational answer with ticket keys, summaries, and
context.

---

## Safety constraints (inline, non-negotiable)

- **Never change Jira status or transition an issue.** Read and search only.
- **Never add a comment directly into Jira** (no MCP comment-add, no browser
  submit). Reply staging is local-MD fragments only, via
  `stage-local-draft.js`.
- **Never send, submit, or post** anything. Drafts are staged for human review.

---

## Error handling

| Scenario | Action |
|---|---|
| Jira MCP tools unavailable | Fall back to script, then browser; report which path was used |
| Script returns `ok: false` | Report the envelope `errors`, mark Jira **unavailable** for the run — do not fail silently |
| Login screen (browser fallback) | Stop, report "JIRA requires login" |
| Network / page won't load / off VPN | Report "JIRA unavailable — unreachable, check VPN?" |
| A project can't be scanned (auth/scope) | Skip it, log it in the Coverage line, continue |
| `draft_enabled` is `false`/missing | Skip Step 3 entirely — no drafts this run, no error |
| No tickets found | Report "Nothing to report." — not an error |
