---
name: morning-confluence
description: Confluence DC sub-agent — three-step workflow (gather via REST API script, analyze page changes/mentions, stage draft page comments as local Markdown fragments). Read-only — never edits pages directly. Supports Morning Brief and Deep Dive modes.
allowed-tools: bash, computer
---

# Morning Confluence

Read-only — never edit pages or add comments directly. Draft page comments are written as local Markdown fragments for the user to review and post manually.

## Load config

Read: `{scripts_path}/../config/confluence.json`

Extract: `url` (Confluence base URL), `spaces` (array of space keys), `lookback_hours_override`.

Load version state (may not exist on first run):
Read: `~/.claude/skills/morning-assistant/state/wiki-state.json`

---

## Morning Brief Mode

### Step 1 — GATHER (fast)

**gather_method = "script":** Run the helper script:

```bash
node {scripts_path}/fetch-confluence.js --brief
```

Parse the JSON output. The script handles:
- Recently updated pages in configured spaces
- Version comparison against wiki-state.json
- @mentions in comments

If `ok: false`, report errors and skip Confluence.

**gather_method = "browser" (fallback):** Navigate to Confluence via Claude in Chrome. Scan "Recently Updated" per space and the notification bell for @mentions.

### Step 2 — ANALYZE (fast)

The script pre-filters pages using config rules (`exclude_title_patterns`, `skip_if_only_mentions` + `my_context_keywords`) before returning results. @mention pages are never filtered by the script — always surface those.

The script also enriches pages with `changeSummary` (a human-readable description of what changed) and `totalChange` (a numeric score). Pages with trivial changes (below `min_change_chars` in config) are already filtered out by the script.

From the remaining results, prioritize:
- @mentioned the user in a comment (highest priority — always keep)
- Decision records, runbooks, architecture docs
- Significant content changes (new sections, not typo fixes)
- Pages related to user's work areas (infer from JIRA project keys in config)

Skip: pages the user themselves edited.

Deduplicate: if a page appears in both changes and mentions, mark as `mentioned`.

### Step 3 — Update version state

After processing, update wiki-state.json with current page versions:

```bash
node -e "
import { writeFile, mkdir } from 'node:fs/promises';
import { join, homedir } from 'node:path';
const dir = join(homedir(), '.claude/skills/morning-assistant/state');
await mkdir(dir, { recursive: true });
const state = { lastRun: new Date().toISOString(), pages: { /* populated */ } };
await writeFile(join(dir, 'wiki-state.json'), JSON.stringify(state, null, 2));
"
```

### Step 3 — DRAFT (local MD fragment — if draft_enabled)

Confluence is read-only — we never edit pages or post comments via API. But the user may want to draft page comments for items where they were @mentioned or where a discussion needs their input.

For each draft target (pages where user was mentioned with a question, or decision pages needing review feedback):

#### 3a. Enrich context

Run: `node {scripts_path}/fetch-confluence.js --context <pageId>`

This fetches the full page with all comments, so the draft has enough context.

#### 3b. Generate draft text

Write a draft page comment in plain text or simple Confluence wiki markup.

#### 3c. Stage as local MD fragment

Pipe to: `node {scripts_path}/stage-local-draft.js --vault {vault_path}`

Input (JSON on stdin):
```json
{
  "tool": "confluence",
  "target": "3679259926",
  "url": "https://wiki.corp.adobe.com/...",
  "title": "Page Title",
  "context": "Ravi mentioned you asking for review of auth approach",
  "draft": "The draft comment text"
}
```

Writes to: `{vault}/drafts/YYYY-MM-DD-confluence-{pageId}-comment.md`

**Skip drafting for:** Pages with no question directed at user; minor formatting edits; pages the user themselves edited.

See: `docs/decisions/ADR-002-draft-generation-and-delivery.md`

### Output

Return to orchestrator:
- Daily note section (formatted markdown)
- Draft targets list (if any)

### Daily note section format

**Include the `changeSummary`** from the script output for every page. This tells the user what actually changed, not just that it was modified.

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
```

If nothing to report (all pages were trivial): `_N pages updated — all trivial changes filtered._`

---

## Deep Dive Mode

Answer the user's question about Confluence. No draft staging.

**gather_method = "script":** Run `node {scripts_path}/fetch-confluence.js --search "query terms"`
**gather_method = "browser":** Navigate to Confluence search with keywords and space filters.

Return a direct, conversational answer with page titles, excerpts, and links.

---

## Error handling

| Scenario | Action |
|---|---|
| Script returns `ok: false` | Report errors, skip Confluence |
| Login screen (browser) | Stop, report "Confluence requires login" |
| Network error | Report "Confluence unreachable — check VPN?" |
| Space not found | Skip that space, continue |
| wiki-state.json missing | Treat all pages as new, continue |

## Safety constraint

**Never edit pages or add comments via the Confluence API or browser.** Draft comments are written as local Markdown files only — the user reviews and posts them manually. If the editor opens accidentally, close without saving.
