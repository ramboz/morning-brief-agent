---
name: morning-confluence
description: Confluence sub-agent — MCP-first read-only workflow (gather watched-page changes/mentions/search hits via Confluence/wiki MCP tools, analyze and prioritize, render a read-only daily-note section). Falls back to scripts/fetch-confluence.js, then browser. Never edits pages or comments, never stages a draft. Supports Morning Brief and Deep Dive modes.
allowed-tools: bash, computer
---

# Morning Confluence

Per [ADR-0004](../../docs/decisions/adr-0004-mcp-plugin-first-source-integration.md)
and [spec 007](../../docs/specs/007-mcp-source-migration/spec.md), the
Confluence/wiki MCP tools available in the running session are the primary path
for gather. `scripts/fetch-confluence.js` is the fallback interface, and browser
navigation is the last resort — see the fallback-scope note in Step 1 and
`docs/architecture.md`'s "Confluence: MCP-First With Bounded Fallbacks" for the
full boundary (slice 007-02).

**Confluence is read-only in this project.** This workflow gathers, triages, and
renders — it never edits a page, never adds a comment (no MCP page/comment
write, no browser submit), and stages **no draft** of any kind. See the inline
safety constraints below and Review-First Safety in `docs/architecture.md`.

This skill runs in an interactive session because the Confluence/wiki MCP tools
require one — it is not wired into the headless `scripts/write-brief.js`
composer. See "Legacy Cowork skill layer" in
[docs/refinement-todo.md](../../docs/refinement-todo.md) for why these two stay
separate for now.

## Load config

Read: `{scripts_path}/../config/confluence.json` — `{scripts_path}` is the
repo's `scripts/` directory (provided via `config/main.json`), so this path
resolves to the **project-root `config/confluence.json`**, the same file the
fallback loader `scripts/lib/config.js` reads. It is not under `skills/`.

Extract: `url` (Confluence base URL), `spaces` (array of space keys — the
explicit, user-provided scope), `lookback_hours_override`, and the pre-filter
rules (`min_change_chars`, `exclude_title_patterns`, `skip_if_only_mentions`,
`my_context_keywords`). This workflow never claims instance-wide Confluence
coverage — only `spaces` is ever scanned.

Load version state — plain, inspectable JSON:
Read: `~/.claude/skills/morning-assistant/state/wiki-state.json`

This read is **best-effort**: the file may not exist on the first run, and the
`~/.claude/skills/morning-assistant/state/` tree may be absent entirely in a
non-Cowork/Codex runtime. If the file or its directory is missing, treat every
page as new (no prior versions) and continue — do not stop. The Step 3 write
self-heals the directory (`mkdir` recursive).

If config is missing or `spaces` is empty, stop:
> Confluence config missing — please create `confluence.json` from
> `confluence.example.json`.

---

## Morning Brief Mode

### Step 1 — GATHER (fast, read-only)

**Primary — Confluence/wiki MCP tools:** Use the Confluence/wiki MCP tools
available in the running session (referenced here by capability, since exact
tool identifiers vary by session). Scoped to the configured `spaces` and the
lookback window, run the same two-pass read the project has always used:

1. **Page search — recently modified:** pages in the configured `spaces`
   modified within the lookback window (page type only), so watched-space
   changes surface.
2. **Mention/search hits:** comments or pages within the configured `spaces`
   that mention the current user within the lookback window — these are the
   highest-priority items and are never filtered out.

For any page that needs its full content or comment thread (Step 2 change
summary, mention context), use the MCP **page read** capability to pull the
complete page — body, version, ancestors/breadcrumb, and comments.

**If the MCP tools are unavailable:** fall back to
`node {scripts_path}/fetch-confluence.js --brief` (parse the JSON envelope),
then to browser navigation (the Confluence web UI via Claude in Chrome —
check for login, scan each watched space's "Recently Updated", and the
notification bell for @mentions) as a last resort. **Note which path was used
in the output — never silently substitute one for another.** All three paths
are read-only.

**Fallback scope matches the primary path (slice 007-02) — note in Coverage
when the script fallback is used:** `fetch-confluence.js --brief` runs the same
two-pass scan (recently-modified pages + mention comments) over the same
`spaces` scope and emits the standard envelope
`{ok, tool, mode, timestamp, data, errors}`. The script already applies the
config pre-filters (`exclude_title_patterns`, `skip_if_only_mentions` +
`my_context_keywords`, `min_change_chars`) and enriches each page with a
`changeSummary` and `totalChange` score. If it returns `ok: false`, report the
`errors` and mark Confluence **unavailable** for this run (see Error handling) —
do not fail silently. The fallback is a documented subset of the primary path,
not a second, competing implementation.

**Track coverage as you go**, per configured space — three possible states:
- **quiet** — scanned, zero matching page changes/mentions in the lookback
  window.
- **active outside window** — has activity, but it falls just outside the
  lookback window (say so rather than lumping it in with quiet).
- **unreachable** — couldn't scan this space this run (auth/scope error).

This feeds the Coverage note in Step 2/Output. Do not expand scope beyond
`spaces` to compensate for a quiet or unreachable entry.

### Step 2 — ANALYZE (fast)

Apply the same pre-filtering and prioritization the project has always used.
When the MCP path returned raw pages, apply the config rules yourself; when the
script fallback ran, they are already applied — either way the result is the
same triaged set.

**Pre-filter** (config-driven, both opt-in):
- `exclude_title_patterns` — drop pages whose title matches a listed regex
  (sprint-ceremony pages, auto-generated reports, etc.).
- `skip_if_only_mentions` + `my_context_keywords` — drop a page whose
  title+excerpt mentions a "skip" keyword but **none** of the user's context
  keywords (a discussion purely about another product). If both appear
  (cross-product discussion), keep the page.
- `min_change_chars` — drop pages whose `totalChange` score falls below the
  threshold (trivial typo/whitespace edits). New pages (version 1) and pages
  whose diff couldn't be computed always surface.
- **@mention pages are never filtered** — if the user was mentioned, always
  keep the page regardless of any rule above.

**Prioritize** the remaining pages:
- @mentioned the user in a comment — highest priority, always keep.
- Decision records, runbooks, architecture docs.
- Significant content changes (new sections, not typo fixes).
- Pages related to the user's work areas (infer from `my_context_keywords` /
  JIRA project keys in config).

**Skip:** pages the user themselves edited.

**Deduplicate:** if a page appears in both changes and mentions, mark it as
`mentioned` (mention precedence).

**Coverage note (required, per AC1):** report all three states tracked in
Step 1 — quiet, active-outside-window, unreachable — rather than omitting any
silently, and name which gather path ran (MCP / script / browser). A short line
per state is enough. Never imply full instance coverage.

### Step 3 — UPDATE VERSION STATE (minimal plain JSON, AC3)

After processing, write the current page versions back to `wiki-state.json` so
the next run can diff against them. Keep it plain, inspectable JSON — a
`lastRun` timestamp and a `pages` map of page id → version number. No database,
no complex state.

```bash
node -e "
import { writeFile, mkdir } from 'node:fs/promises';
import { join, homedir } from 'node:path';
const dir = join(homedir(), '.claude/skills/morning-assistant/state');
await mkdir(dir, { recursive: true });
const state = { lastRun: new Date().toISOString(), pages: { /* id: version */ } };
await writeFile(join(dir, 'wiki-state.json'), JSON.stringify(state, null, 2));
"
```

On the first run (or if `wiki-state.json` is missing), treat all pages as new
and write the file fresh.

### Output

Return to orchestrator:
- Daily note section (formatted markdown)

There are **no draft targets** — Confluence is read-only, so this workflow
never produces a Staged Drafts entry.

### Daily note section format

**Include the `changeSummary`** for every page. This tells the user what
actually changed, not just that a page was modified.

```markdown
### Pages Needing Attention
- 📝 **[Auth Service Architecture](https://confluence.co/display/ENG/...)** — `ENG`
  ~45 words added, ~12 removed — Alice added a token refresh edge case section
  *(Engineering > Backend · v14 · 2h ago)*

- 🔔 **[Deployment Runbook](https://confluence.co/display/OPS/...)** — `OPS` *(you were mentioned)*
  "Can @you review the rollback section before we publish?"
  *(Operations · v3 · 3h ago)*

- 📝 **[Q2 Roadmap](https://confluence.co/display/PROD/...)** — `PROD`
  new page
  *(Product · v1 · 5h ago)*

### Coverage
_Gathered via Confluence/wiki MCP tools. Quiet this run: OPS, INFRA. No spaces unreachable._
```

If nothing to report (all pages were trivial):
`_N pages updated — all trivial changes filtered._`

**Self-check before returning:** every page links to its Confluence URL; every
page shows its `changeSummary`; @mentioned pages state what was asked; there is
a Coverage line naming the gather path and per-space state; there is **no**
draft/comment-staging output anywhere. If not, fix it before returning to the
orchestrator.

---

## Deep Dive Mode

Answer the user's question about Confluence. Read-only — no draft staging (there
is none for Confluence).

**Primary — Confluence/wiki MCP tools:** use the **page search** capability with
the user's keywords (and any space/date modifiers), scoped to `spaces` unless
the user explicitly asks to search wider. Use **page read** to pull full context
for a hit.
**Fallback — script:** run `node {scripts_path}/fetch-confluence.js --search "query terms"`.
**Fallback — browser:** navigate to Confluence search, enter keywords with space
filters.

Return a direct, conversational answer with page titles, excerpts, and links.

---

## Safety constraints (inline, non-negotiable)

- **Never edit a Confluence page.** Read and search only — Confluence is
  strictly read-only in this project.
- **Never add a comment** into Confluence (no MCP page/comment write, no browser
  submit).
- **Never stage a draft** of any kind. This workflow has no drafting step; there
  is no local-MD comment fragment, no browser compose, nothing to send.
- **Never send, submit, or post** anything.
- If a page editor or comment box opens accidentally, close it without saving.

---

## Error handling

| Scenario | Action |
|---|---|
| Confluence/wiki MCP tools unavailable | Fall back to script, then browser; report which path was used |
| Script returns `ok: false` | Report the envelope `errors`, mark Confluence **unavailable** for the run — do not fail silently |
| Login screen (browser fallback) | Stop, report "Confluence requires login" |
| Network / page won't load / off VPN | Report "Confluence unreachable — check VPN?" |
| A space can't be scanned (auth/scope) | Skip it, log it in the Coverage line, continue |
| `wiki-state.json` missing | Treat all pages as new, write the file fresh, continue |
| No page changes/mentions found | Report "Nothing to report." — not an error |
