# Skill: Implement a Phase

Use this skill whenever you are asked to implement a phase of the morning-briefing project.

---

## Step 1 — Read Project Context First (Always)

Before writing a single line of code, read these files in order:

1. `CLAUDE.md` — project conventions, structure, what NOT to do
2. `specs/00-architecture.md` — overall system design and data flow
3. The spec file(s) for this phase (listed in the task)

Do not skip this step even if you have already read them in a previous session. Each session starts fresh.

---

## Step 2 — Understand the Phase Scope

Identify from the task:
- Which spec file(s) are in scope
- Which source module(s) to create or modify
- Whether `src/ai/summarize.js` needs new functions
- Whether `src/output/dailyNote.js` needs new rendering logic
- Whether `src/index.js` needs updating

**Only implement what the spec says.** If something seems like a good idea but is not in the spec, add a `// TODO: [your suggestion]` comment and move on. Do not gold-plate.

---

## Step 3 — Implement

Follow the spec precisely. Key reminders from CLAUDE.md:

- ESM only — `import/export`, never `require()`
- Every source function returns `{ ok: true, data: ... }` or `{ ok: false, error: string }` — never throw from a source module
- All write operations must check `isDryRun` before executing
- No external libraries beyond what is already in `package.json` unless the spec explicitly requires one
- Use built-in `fetch` for HTTP calls — no axios
- Keep logic flat and explicit — no clever abstractions

---

## Step 4 — Handle TODOs and Uncertainties

During implementation you may encounter:

**API endpoints that are unclear or may have changed:**
- Implement a stub that returns mock data shaped correctly
- Add a prominent comment: `// TODO: verify endpoint — stubbed with mock data`
- Log a console warning at runtime: `[module] WARNING: using stubbed data for X`
- Never silently return empty data without a warning

**Spec gaps (something the spec doesn't address):**
- Choose the simplest reasonable behaviour
- Add a comment: `// TODO: spec gap — assumed [your decision]. Verify with user.`

**Permissions or access issues (e.g. API returns 403):**
- Handle gracefully with `{ ok: false, error: '403 — check permissions for X' }`
- Add a comment explaining what permission or config is likely missing

Collect all TODOs and surface them in a summary at the end (see Step 6).

---

## Step 5 — Add the Standalone Runner

Every new source module must have a standalone runner at the bottom:

```js
import { fileURLToPath } from 'url'

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // import auth if needed
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const result = await fetch[ModuleName](/* args */)
  console.log(JSON.stringify(result, null, 2))
}
```

Then run it to verify the module works before finishing:

```bash
node src/sources/[module].js
```

If the run fails, fix the issue before moving on. Do not leave a broken standalone runner.

---

## Step 6 — Verify Integration

After implementing the source module, update `src/index.js` to include it in the `Promise.allSettled()` call and update `src/output/dailyNote.js` to render its section.

Then do a full dry-run to verify the daily note is generated correctly:

```bash
node src/index.js --dry-run
```

Check that:
- The new section appears in `./output/{DATE}.md`
- Other sections are unaffected
- No unhandled errors or uncaught promise rejections in the console
- Any `{ ok: false }` results are logged and rendered gracefully in the note

---

## Step 7 — Commit

Once the dry-run passes, commit with a clear message:

```bash
git add -A
git commit -m "feat: implement Phase X — [phase name]

- Add src/sources/[module].js
- Add summarize[Module]() to src/ai/summarize.js
- Update dailyNote.js with [section] rendering
- Update index.js orchestrator

TODOs:
- [list any stubbed endpoints or spec gaps]"
```

The commit message must list any TODOs so they are easy to find later.

---

## Step 8 — End of Session Summary

At the end of the session, provide a brief summary:

```
## Phase X Complete ✅

### What was implemented
- [bullet list of files created/modified]

### Works correctly
- [what the standalone runner confirmed]
- [what the dry-run confirmed]

### TODOs for follow-up
- [ ] [any stubbed endpoints]
- [ ] [any spec gaps]
- [ ] [any permissions to verify]

### Ready for next phase
Phase X+1 is: [name]. Spec: specs/0X-[name].md
```

---

## Quick Reference — Phase List

| Phase | Name | Key Spec(s) |
|---|---|---|
| 1 | Scaffold + Auth | `specs/02-auth.md` |
| 2 | Outlook Email | `specs/03-outlook.md` |
| 3 | Summarization + Email Note | `specs/09-summarization.md` |
| 4 | Slack | `specs/04-slack.md` |
| 5 | JIRA + Confluence | `specs/06-jira.md`, `specs/07-confluence.md` |
| 6 | GitHub | `specs/08-github.md` |
| 7 | Teams | `specs/05-teams.md` |
| 8 | Action Items + Polish | — |
