# Spec 09 — Obsidian Daily Note Output

## Overview

The script writes (and on re-runs, smart-merges) a daily note into the user's Obsidian vault. The note is a living document — re-running the script during the day adds new items and updates existing ones without destroying anything the user has already written or marked done.

---

## File Location

```
{OBSIDIAN_VAULT_PATH}/{OBSIDIAN_DAILY_NOTES_FOLDER}/{DATE}.md
```

**Example:**
```
C:/Users/username/Google Drive/MyVault/Daily Notes/2026-03-02.md
```

**Date format:** controlled by `OBSIDIAN_DATE_FORMAT` env var, default `YYYY-MM-DD`.

**In dry-run mode:** write to `./output/{DATE}.md` instead. Create the `./output/` directory if it doesn't exist.

---

## Daily Note Template

Every daily note starts from this exact template on first run. Section headers must match character-for-character — the merge logic depends on them.

```markdown
# Daily Brief — 2026-03-02

> ⏱️ Last updated: 08:02 — 3 sources • 12 items

## ⚡ Action Items
<!-- AGENT:action_items -->

## 📬 Email
### Action Required
<!-- AGENT:email_action -->

### FYI / Reading
<!-- AGENT:email_fyi -->

### Auto-Archived
<!-- AGENT:email_archived -->

## 💬 Slack
### 🔴 Mentions & Threads
<!-- AGENT:slack_mentions -->

### Direct Messages
<!-- AGENT:slack_dms -->

<!-- AGENT:slack_sections_dynamic -->

### Other Channels
<!-- AGENT:slack_other -->

## 💬 Yesterday's Meetings
<!-- AGENT:meetings -->

## 💬 Teams Activity
### Mentions & Replies
<!-- AGENT:teams_activity -->

## 🎫 JIRA
### Updated Tickets
<!-- AGENT:jira_tickets -->

### Discussions to Join
<!-- AGENT:jira_discussions -->

## 📖 Confluence
### Recent Changes
<!-- AGENT:confluence -->

## 💻 GitHub
### github.com
<!-- AGENT:github_com -->

### Corporate GitHub
<!-- AGENT:github_corp -->
```

---

## Agent Comment Anchors

Each managed section contains an HTML comment anchor: `<!-- AGENT:{key} -->`. These are invisible in Obsidian's rendered view but parseable by the script.

**Critical rule:** The script only writes content within anchored sections. Anything the user writes outside these anchors (notes, tasks, reflections) is **never touched**.

---

## Dynamic Slack Sections

The Slack section contains a dynamic number of subsections based on `slack-sections.json`. Each section gets its own anchor:

```
<!-- AGENT:slack_section_Engineering -->
<!-- AGENT:slack_section_Product -->
<!-- AGENT:slack_section_Company -->
```

The `<!-- AGENT:slack_sections_dynamic -->` anchor in the template is a **placeholder** that gets replaced on first run with the actual section anchors. On re-runs, the individual section anchors are used for smart merge.

The output module must:
1. On first run: replace `slack_sections_dynamic` with the rendered section content including individual anchors
2. On re-runs: find and update each `slack_section_{Name}` anchor individually
3. If a section disappears from `slack-sections.json`, preserve existing content in the note under that anchor — never delete

---

## First Run Behavior

1. Check if `{DATE}.md` exists in the vault
2. If it does not exist: create it from the template above, populate all sections
3. If it already exists but has no `<!-- AGENT:... -->` anchors: it was manually created — **append** a new `## 🤖 Morning Brief` section at the bottom rather than modifying existing content
4. If it already exists with anchors: run the smart merge (see below)

---

## Smart Merge Behavior (Re-run During the Day)

The merge strategy preserves user edits while adding new information from the latest run.

### How It Works

1. Read the existing file content
2. Parse each `<!-- AGENT:{key} -->` anchored section by finding content between consecutive anchors (or between an anchor and the next `##` heading)
3. For each section, run the merge logic below
4. Write the updated file

### Section Merge Rules

#### ⚡ Action Items
- Parse existing items as a list (lines starting with `- [ ]`, `- [x]`, or `- `)
- Items marked `- [x]` (completed by user) are **always preserved as-is, never removed**
- New items from this run are compared against existing items by content similarity
- If a new item is substantively the same as an existing unchecked item: **update in place** (refresh the summary text, keep the checkbox state)
- Genuinely new items are **prepended** above existing unchecked items
- Format: `- [ ] [Source] Description`

**Example after merge:**
```markdown
## ⚡ Action Items
<!-- AGENT:action_items -->
- [ ] [Email] Reply to Jane re: Q1 roadmap input needed before Friday
- [ ] [JIRA] Review PR #482 — blocking release
- [x] [GitHub] Approve dependabot PR on morning-briefing repo
```

#### Email Sections (Action Required, FYI, Auto-Archived)
- Each email item is identified by its **subject line**
- If an email from this run already exists in the section: update its summary text in place
- New emails are prepended at the top of the section
- User-written items (lines without a recognizable email subject pattern) are preserved as-is

#### Yesterday's Meetings
- Each meeting item is identified by its **title + date**
- If a meeting already exists: update transcript summary in place (transcript may have been processed late)
- New meetings are prepended
- Meetings are never removed

#### Teams Activity
- Items identified by timestamp + author
- New mentions/replies prepended
- Existing items preserved

#### JIRA, Confluence, GitHub sections
- Items identified by ticket key (JIRA), page title (Confluence), or notification title + repo (GitHub)
- New items prepended
- Existing items updated in place if same key is found
- User annotations on existing items (lines the user added below an item) are preserved

---

## Update Header

After every run (first or re-run), update the header line:

```markdown
> ⏱️ Last updated: 14:35 — 5 sources • 18 items
```

- Time is local time (not UTC)
- "Sources" = number of sources that returned `ok: true`
- "Items" = total action items in the ⚡ section (including completed ones)

---

## Empty Sections

If a section has no content after a run, write:
```markdown
_Nothing to report._
```

Never leave a section completely blank (makes the note look broken in Obsidian).

---

## Footer

Append at the very end of the file (outside any anchor):

```markdown
---
*Brief generated by morning-briefing-agent • [source](https://github.com/yourrepo/morning-briefing)*
```

Only write this on first creation — do not duplicate on re-runs.

---

## Exported API

```js
// src/output/dailyNote.js

/**
 * Writes or smart-merges the daily note into the Obsidian vault.
 * @param {object} sections - keyed by AGENT anchor name
 * @param {object} options - { dryRun: boolean }
 * @returns {Promise<{ ok: boolean, path: string, isNew: boolean }>}
 */
export async function writeDailyNote(sections, options)

/**
 * Returns the full path to today's daily note.
 * @returns {string}
 */
export function getDailyNotePath()
```

---

## Error Handling

| Scenario | Behaviour |
|---|---|
| Vault path does not exist | Throw with clear message: `[output] Vault path not found: {path}. Check OBSIDIAN_VAULT_PATH in .env` |
| Daily Notes folder does not exist | Create it automatically |
| File write fails (permissions, disk full) | Throw — this is fatal, log error and exit |
| Merge parse error (malformed anchors) | Log warning, fall back to appending new content at bottom of file rather than merging |
| Dry-run output folder missing | Create `./output/` automatically |

---

## Notes for Implementation

- Use `fs/promises` (built-in) for all file operations — no external file libraries
- The anchor comment parsing should be done with simple string splitting on `<!-- AGENT:` tokens, not regex
- When comparing items for deduplication (e.g. same email subject), use case-insensitive exact match — do not attempt fuzzy matching
- Always write the file with UTF-8 encoding
- Preserve trailing newline at end of file
