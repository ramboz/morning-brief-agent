---
name: morning-confluence
description: Confluence DC sub-agent — three-step workflow (gather via REST API script, analyze page changes/mentions, no draft staging). Read-only. Supports Morning Brief and Deep Dive modes.
allowed-tools: bash, computer
---

# Morning Confluence

Read-only — never edit pages or add comments.

## Load config

Read: `~/.claude/skills/morning-confluence/config/confluence-spaces.json`

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

Filter to pages worth surfacing:
- @mentioned the user in a comment (highest priority)
- Decision records, runbooks, architecture docs (high-value)
- Significant content changes (new sections, not typo fixes)
- Related to user's work areas (infer from JIRA project keys)

Skip: minor formatting edits, pages the user themselves edited, irrelevant admin content.

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

**No draft staging** — Confluence is strictly read-only.

### Output

Return to orchestrator:
- Daily note section (formatted markdown)
- No draft targets

### Daily note section format

```markdown
### Pages Needing Attention
- 📝 **[Auth Service Architecture](https://confluence.co/display/ENG/...)** — `ENG`
  Alice added a token refresh edge case section — may affect your area
  *(Engineering > Backend · v14 · 2h ago)*

- 🔔 **[Deployment Runbook](https://confluence.co/display/OPS/...)** — `OPS` *(you were mentioned)*
  "Can @you review the rollback section before we publish?"
  *(Operations · v3 · 3h ago)*
```

If nothing to report: `_Nothing to report._`

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

**Never edit pages or add comments.** If the editor opens accidentally, close without saving.
