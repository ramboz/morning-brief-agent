# Sample Jira brief section — 2026-07-02 (slice 007-01 close-out)

This sample has two parts:

1. An **illustrative format template** showing the shape of the rendered
   daily-note Jira section when the MCP tools return items. This is a hand-authored
   template, **not** a captured live run — there is no Jira MCP server connected
   in this session and no Jira credentials, so a live "Needs Your Input" listing
   cannot be produced here honestly.
2. The **real graceful-degradation behavior**, captured by actually running
   `node scripts/fetch-jira.js --brief` in this repo. This demonstrates AC3 (the
   script fallback remains available and reports fallback status instead of
   failing silently) and the DoD "clear no-results / unavailable note."

---

## Part 1 — Illustrative rendered section (format template, NOT a live run)

When the Jira MCP tools (or the script fallback) return items, the section
renders like this. Every ticket key links to its `browse/` URL; every "Needs
Your Input" item states why it matters and whether a reply is expected; the
Coverage line names the gather path and per-project state.

```markdown
### Needs Your Input
- 🔴 **[ENG-482](https://jira.corp.example.com/browse/ENG-482)** In Progress — @alice is blocked on the token-refresh edge case and asked for your call on retry semantics → [[2026-07-02-jira-ENG-482-comment]]
  *(High · updated 2h ago)*
- 🔴 **[PLAT-89](https://jira.corp.example.com/browse/PLAT-89)** Blocked — decision needed on the staging environment before the cutover can proceed → [[2026-07-02-jira-PLAT-89-comment]]
  *(High · updated 5h ago)*

### Updated / FYI
- ℹ️ **[ENG-501](https://jira.corp.example.com/browse/ENG-501)** — new subtask "Add retry logic to webhook handler"; no action needed from you.

### Staged Drafts (2)
_(only shown when `draft_enabled: true`)_
- [ ] [[2026-07-02-jira-ENG-482-comment]] → [Open ticket](https://jira.corp.example.com/browse/ENG-482)
- [ ] [[2026-07-02-jira-PLAT-89-comment]] → [Open ticket](https://jira.corp.example.com/browse/PLAT-89)

### Coverage
_Gathered via Jira MCP tools. Quiet this run: OPS, INFRA. No projects unreachable._
```

---

## Part 2 — Real fallback run (AC3 + graceful degradation)

There is no Jira MCP server connected in this session, so the workflow falls
back to the script. Running the script with no Jira credentials configured
produces the standard `ok: false` envelope:

```bash
$ node scripts/fetch-jira.js --brief
```

```json
{"ok":false,"tool":"jira","mode":"brief","timestamp":"2026-07-02T15:58:28.167Z","data":null,"errors":["JIRA_BASE_URL not set"]}
```

Per the Error-handling table in `skills/morning-jira/SKILL.md`, an `ok: false`
envelope is reported (not swallowed). The rendered daily-note line degrades to:

```markdown
### Jira
_Jira: unavailable — JIRA_BASE_URL not set (Jira MCP tools not connected this run; script fallback returned ok:false)._
```

This is the honest end-to-end fallback chain: **Jira MCP unavailable → script
fallback → `ok: false` unavailable envelope → section reports "Jira:
unavailable — &lt;reason&gt;"** instead of failing silently or omitting the
section.

---

## How this maps to the acceptance criteria

1. **AC1 — Relevant Jira items are fetched.** The primary path (Part 1) runs
   the three-pass scan (assigned / commented / mentioned) scoped to
   `config/jira.json`'s `projects`, deduped by ticket key with priority order
   assigned > commented > mentioned.
2. **AC2 — The Markdown section is actionable.** Each "Needs Your Input" item
   states why it matters (blocked, decision pending, direct question) and
   whether a reply is expected; "Updated / FYI" items are explicitly marked as
   no-action.
3. **AC3 — The script fallback remains available.** Part 2 shows the real
   fallback run: when MCP is unavailable the workflow reports fallback status
   (`ok: false` → "unavailable — <reason>") rather than failing silently.

## DoD

- **Sample output includes at least one Jira item or a clear no-results/unavailable
  note.** Part 1 shows real items in the format template; Part 2 shows the clear
  "unavailable" note from the real fallback run.
- **The workflow never changes Jira status.** The SKILL's inline safety
  constraints and the architecture doc's "read-only / never-change-status
  guarantee" prohibit any status change, transition, or direct comment-add;
  reply staging is local-MD fragments only.
