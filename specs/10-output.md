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

## 🔥 Focus Areas
<!-- AGENT:focus_areas -->

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

### Thread Updates
<!-- AGENT:slack_threads -->

### Direct Messages
<!-- AGENT:slack_dms -->

### Priority Channels
<!-- AGENT:slack_channels -->

### Other Channels
<!-- AGENT:slack_other -->

## 💬 Yesterday's Meetings
<!-- AGENT:meetings -->

## 💬 Teams Activity
### Mentions & Replies
<!-- AGENT:teams_activity -->

## 🎫 JIRA
### Needs Your Input
<!-- AGENT:jira_tickets -->

### Discussions to Join
<!-- AGENT:jira_discussions -->

## 📖 Confluence
### Pages Needing Attention
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
2. Parse each `<!-- AGENT:{key} -->` anchored section by finding content between consecutive anchors (or between an anchor and the next `##`/`###` heading)
3. For each section, run the merge logic below
4. Write the updated file

### Anchor Boundary Detection

When finding the end boundary of an anchored section, check whether the line immediately preceding the next `<!-- AGENT: -->` anchor is a `##` or `###` heading. If so, the heading belongs to the *next* section and must be excluded from the current section's content (preserve it, don't overwrite it). Slice the replacement content to end before the heading line, not at the `\n` immediately before the anchor tag.

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

#### 🔥 Focus Areas
- Fully overwrite on each run — no merge, no user edits expected here
- If no clusters (no topics with 2+ source signals): write `_No cross-source patterns today._`
- Format: one `###` heading per cluster, followed by source-tagged bullet lines
- See `specs/09-summarization.md` for the rendered format

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

#### JIRA, Confluence, GitHub, and Slack Thread sections
- Items identified by ticket key (JIRA), page title (Confluence), notification title + repo (GitHub), or thread timestamp (Slack threads)
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

If a source was unreachable due to VPN or network error, write:
```markdown
_Skipped — not on VPN_
```

If a source failed for any other reason, write:
```markdown
_Source unavailable: {error message}_
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

## Slack DM Output

After the daily note is written, the agent posts a summary to the user's own Slack DM as a secondary delivery channel — so the brief surfaces in the user's natural Slack workflow without requiring them to open a file.

### Behaviour

- Implemented as `postBriefToSlack(actionItems, clusters)` in **`src/sources/slack.js`** (reuses the existing Slack client and user ID from `fetchSlack()`)
- Called from `index.js` **after** `writeDailyNote()` completes
- Gated by `isDryRun` — in dry-run mode, logs `[slack] DRY RUN — would post brief to self` and skips
- If Slack is unavailable (source returned `ok: false`), skip with a log message — do not error
- The user's own Slack member ID comes from the `auth.test()` call already performed during `fetchSlack()` — pass it through from the fetch result or re-use the cached client

### Content

The DM contains two sections:
1. **🔥 Focus Areas** — the cross-source project clusters (if any)
2. **⚡ Action Items** — the top action items

Both are already computed by the time this is called. If no clusters exist, omit the Focus Areas block entirely.

### Slack formatting

Use Slack `mrkdwn` format (not GitHub markdown):
- Bold: `*text*` (not `**text**`)
- Links: `<url|text>` (not `[text](url)`)
- Bullets: `•` character
- No heading syntax — use `*Section Title*` on its own line followed by bullets

**Example message:**
```
*Morning Brief — 2026-03-04*

*🔥 Focus Areas*
• *Auth Service* — JIRA (blocked), GitHub (review needed), Slack (3 mentions)
• *Q2 Roadmap* — Confluence (updated), JIRA (debate open)

*⚡ Action Items*
• [JIRA] <https://jira.../browse/ENG-482|ENG-482> — Alice blocked, token refresh edge case
• [GitHub] <https://github.com/...|PR: feat/auth> — review requested
• [Slack] <https://slack.../archives/...|#eng-backend> — caching approach debate, your input wanted
```

### Interface

```js
// src/sources/slack.js

/**
 * Posts the morning brief summary to the user's own Slack DM.
 * @param {string} userId - The authenticated user's Slack member ID
 * @param {object[]} actionItems - From synthesizeActionItems() — array of { source, text, url?, permalink? }
 * @param {object[]} clusters - From synthesizeProjectClusters() — array of { name, signals }
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function postBriefToSlack(userId, actionItems, clusters)
```

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

/**
 * Wraps a render function with Today/Yesterday/Earlier sub-headers when lookback > 72h.
 * Passes through to renderFn unchanged when lookback is short or items don't span
 * multiple days (avoids a lone "Earlier" header when all items are in one bucket).
 * Used by index.js to wrap JIRA, Confluence, and GitHub render calls.
 * @param {object[]} items
 * @param {(item: object) => string|null} getTimestamp - Timestamp accessor
 * @param {(items: object[]) => string} renderFn - Underlying render function
 * @returns {string}
 */
export function withRecencyGrouping(items, getTimestamp, renderFn)

/**
 * Renders the ⚡ Action Items section from synthesizeActionItems() output.
 * @param {object[]} items - Array of { source, text, url?, permalink? }
 * @returns {string}
 */
export function renderActionItems(items)

/**
 * Renders the 🔥 Focus Areas section from synthesizeProjectClusters() output.
 * @param {object[]} clusters - Array of { name, signals: [{ source, summary, url? }] }
 * @returns {string}
 */
export function renderProjectClusters(clusters)
```

### Recency Grouping (PTO mode)

When `lookbackHours > 72` (typically `--days 4` or more), the JIRA, Confluence, and GitHub sections are split into **Today / Yesterday / Earlier** sub-groups using `####` headers. This makes long PTO catch-up briefs scannable — you can focus on today's items first and skim older ones.

- Slack sections are not grouped (inherently time-ordered, lower volume)
- If all items fall into a single time bucket, headers are omitted (no lone "Earlier" heading)
- Timestamps are cross-referenced from original source data (e.g. `issueMap.updatedAt` for JIRA, `page.lastModifiedAt` for Confluence, `notification.updatedAt` for GitHub)

### Permalink Deep Links

`renderSlackThreads(threads, workspaceUrl)` and `renderSlackDMs(dms, workspaceUrl)` accept an optional `workspaceUrl` parameter. When provided, they construct deep links:

- **Threads:** `{workspaceUrl}/archives/{channelId}/p{threadTs}` — links directly to the thread in Slack
- **DMs:** `{workspaceUrl}/archives/{dmChannelId}` — links to the DM conversation

The `channelId`/`threadTs` and `dmChannelId` fields are passed through from the AI summarization output (see spec 09).

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
