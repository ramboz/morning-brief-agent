import 'dotenv/config'
import fs from 'fs/promises'
import path from 'path'
import { isDryRun } from '../utils/flags.js'

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/**
 * Formats a Date as YYYY-MM-DD (local time).
 * @param {Date} [date]
 * @returns {string}
 */
function formatDate(date = new Date()) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * Formats a Date as HH:MM (local time).
 * @param {Date} [date]
 * @returns {string}
 */
function formatTime(date = new Date()) {
  const h = String(date.getHours()).padStart(2, '0')
  const m = String(date.getMinutes()).padStart(2, '0')
  return `${h}:${m}`
}

/**
 * Returns a human-readable relative time string (e.g. "2h ago", "3d ago").
 * @param {string|null} dateStr
 * @returns {string}
 */
function relativeTime(dateStr) {
  if (!dateStr) return 'unknown'
  const diff = Date.now() - new Date(dateStr).getTime()
  const hours = Math.floor(diff / (60 * 60 * 1000))
  if (hours < 1) return 'just now'
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

/**
 * Returns the full path to today's daily note.
 * In dry-run mode, returns a path inside ./output/.
 * @param {boolean} [dryRun]
 * @returns {string}
 */
export function getDailyNotePath(dryRun = isDryRun) {
  const date = formatDate()
  if (dryRun) return path.join('./output', `${date}.md`)

  const vaultPath = process.env.OBSIDIAN_VAULT_PATH
  if (!vaultPath) throw new Error('[output] OBSIDIAN_VAULT_PATH is not set in .env')

  const folder = process.env.OBSIDIAN_DAILY_NOTES_FOLDER ?? 'Daily Notes'
  return path.join(vaultPath, folder, `${date}.md`)
}

// ---------------------------------------------------------------------------
// Section renderers
// ---------------------------------------------------------------------------

/**
 * Renders the JIRA "Updated Tickets" section content (actionRequired items).
 * @param {object[]} actionRequired - From summarizeJira()
 * @param {Map<string, object>} issueMap - Original issue data keyed by JIRA key
 * @returns {string}
 */
export function renderJiraTickets(actionRequired, issueMap) {
  if (!actionRequired || actionRequired.length === 0) return '_Nothing to report._'

  return actionRequired.map(item => {
    const issue = issueMap?.get(item.key)
    const status = issue?.status ?? ''
    const priority = issue?.priority ?? ''
    const labels = issue?.labels?.join(', ') ?? ''
    const updatedAt = relativeTime(issue?.updatedAt)
    const url = issue?.url ?? ''

    const meta = [priority, labels, updatedAt ? `updated ${updatedAt}` : ''].filter(Boolean).join(' · ')

    let line = `- 🔴 **[${item.key}](${url})** ${status ? `${status} — ` : ''}${item.summary}`
    if (meta) line += `\n  *(${meta})*`
    return line
  }).join('\n')
}

/**
 * Renders the JIRA "Discussions to Join" section content (updates items).
 * @param {object[]} updates - From summarizeJira()
 * @param {Map<string, object>} issueMap - Original issue data keyed by JIRA key
 * @returns {string}
 */
export function renderJiraDiscussions(updates, issueMap) {
  if (!updates || updates.length === 0) return '_Nothing to report._'

  return updates.map(item => {
    const issue = issueMap?.get(item.key)
    const status = issue?.status ?? ''
    const updatedAt = relativeTime(issue?.updatedAt)
    const url = issue?.url ?? ''

    const meta = [status, updatedAt ? `updated ${updatedAt}` : ''].filter(Boolean).join(' · ')

    let line = `- ℹ️ **[${item.key}](${url})** ${item.summary}`
    if (meta) line += `\n  *(${meta})*`
    return line
  }).join('\n')
}

/**
 * Renders the Confluence "Recent Changes" section content.
 * @param {object[]} pages - From summarizeConfluence()
 * @returns {string}
 */
export function renderConfluence(pages) {
  if (!pages || pages.length === 0) return '_Nothing to report._'

  return pages.map(page => {
    const icon = page.needsAttention ? '🔔' : '📝'
    const breadcrumb = page.breadcrumb ? ` *(${page.breadcrumb})*` : ''
    const meta = [
      page.version ? `v${page.version}` : '',
      relativeTime(page.lastModifiedAt),
    ].filter(Boolean).join(' · ')

    let line = `- ${icon} **[${page.title}](${page.url})** — \`${page.space}\``
    line += `\n  ${page.summary}`
    if (meta || breadcrumb) line += `\n  *(${[meta, breadcrumb.replace(/^\s*\*\(|\)\*\s*$/g, '')].filter(Boolean).join(' · ')})*`
    return line
  }).join('\n')
}

/**
 * Renders a GitHub section (github.com or Corporate GitHub).
 * @param {object[]} notifications - From summarizeGithub()
 * @returns {string}
 */
export function renderGithub(notifications) {
  if (!notifications || notifications.length === 0) return '_Nothing to report._'

  return notifications.map(item => {
    const icon = item.needsAction ? '🔴' : 'ℹ️'
    let line = `- ${icon} **[${item.title}](${item.url})** — \`${item.repo}\``
    line += `\n  ${item.summary}`
    return line
  }).join('\n')
}

// ---------------------------------------------------------------------------
// Template builder
// ---------------------------------------------------------------------------

const DAILY_BRIEF_TEMPLATE = `# Daily Brief — {DATE}

> ⏱️ Last updated: {TIME} — {SOURCES} sources • {ITEMS} items

## ⚡ Action Items
<!-- AGENT:action_items -->
{action_items}

## 📬 Email
### Action Required
<!-- AGENT:email_action -->
_Nothing to report._

### FYI / Reading
<!-- AGENT:email_fyi -->
_Nothing to report._

### Auto-Archived
<!-- AGENT:email_archived -->
_Nothing to report._

## 💬 Slack
### 🔴 Mentions & Threads
<!-- AGENT:slack_mentions -->
_Nothing to report._

### Direct Messages
<!-- AGENT:slack_dms -->
_Nothing to report._

<!-- AGENT:slack_sections_dynamic -->

### Other Channels
<!-- AGENT:slack_other -->
_Nothing to report._

## 💬 Yesterday's Meetings
<!-- AGENT:meetings -->
_Nothing to report._

## 💬 Teams Activity
### Mentions & Replies
<!-- AGENT:teams_activity -->
_Nothing to report._

## 🎫 JIRA
### Updated Tickets
<!-- AGENT:jira_tickets -->
{jira_tickets}

### Discussions to Join
<!-- AGENT:jira_discussions -->
{jira_discussions}

## 📖 Confluence
### Recent Changes
<!-- AGENT:confluence -->
{confluence}

## 💻 GitHub
### github.com
<!-- AGENT:github_com -->
{github_com}

### Corporate GitHub
<!-- AGENT:github_corp -->
{github_corp}

---
*Brief generated by morning-briefing-agent*`

/**
 * Builds the full daily note content from rendered section strings.
 * @param {object} rendered - Keyed by AGENT anchor name, values are markdown strings
 * @param {object} meta - { sources: number, items: number }
 * @returns {string}
 */
function buildFromTemplate(rendered, meta) {
  const now = new Date()
  return DAILY_BRIEF_TEMPLATE
    .replace('{DATE}', formatDate(now))
    .replace('{TIME}', formatTime(now))
    .replace('{SOURCES}', String(meta.sources ?? 0))
    .replace('{ITEMS}', String(meta.items ?? 0))
    .replace('{action_items}', rendered.action_items ?? '_Nothing to report._')
    .replace('{jira_tickets}', rendered.jira_tickets ?? '_Nothing to report._')
    .replace('{jira_discussions}', rendered.jira_discussions ?? '_Nothing to report._')
    .replace('{confluence}', rendered.confluence ?? '_Nothing to report._')
    .replace('{github_com}', rendered.github_com ?? '_Nothing to report._')
    .replace('{github_corp}', rendered.github_corp ?? '_Nothing to report._')
}

// ---------------------------------------------------------------------------
// Anchor-based merge (re-run during the day)
// ---------------------------------------------------------------------------

/**
 * Updates content within a specific AGENT anchor in the existing note.
 * Replaces content between <!-- AGENT:{key} --> and the next anchor or ## heading.
 * @param {string} content - Full note content
 * @param {string} key - AGENT anchor key (e.g. 'jira_tickets')
 * @param {string} newContent - New content to insert after the anchor
 * @returns {string} Updated note content
 */
function updateAnchor(content, key, newContent) {
  const anchor = `<!-- AGENT:${key} -->`
  const anchorIdx = content.indexOf(anchor)
  if (anchorIdx === -1) return content

  const afterAnchor = anchorIdx + anchor.length

  // Find where the next section starts (next <!-- AGENT: or next ## heading)
  const nextAnchorIdx = content.indexOf('<!-- AGENT:', afterAnchor)
  const nextHeadingIdx = content.indexOf('\n##', afterAnchor)

  let endIdx
  if (nextAnchorIdx !== -1 && (nextHeadingIdx === -1 || nextAnchorIdx < nextHeadingIdx)) {
    // End just before the next anchor line
    endIdx = content.lastIndexOf('\n', nextAnchorIdx)
  } else if (nextHeadingIdx !== -1) {
    endIdx = nextHeadingIdx
  } else {
    // Anchor is last in file — end at file end
    endIdx = content.length
  }

  return (
    content.slice(0, afterAnchor) +
    '\n' + newContent + '\n' +
    content.slice(endIdx)
  )
}

/**
 * Updates the header line with current run stats.
 * @param {string} content
 * @param {object} meta - { sources: number, items: number }
 * @returns {string}
 */
function updateHeader(content, meta) {
  const timeStr = formatTime()
  const newHeader = `> ⏱️ Last updated: ${timeStr} — ${meta.sources} sources • ${meta.items} items`
  return content.replace(/^> ⏱️ Last updated:.+$/m, newHeader)
}

// ---------------------------------------------------------------------------
// Main exported API
// ---------------------------------------------------------------------------

/**
 * Writes or smart-merges the daily note into the Obsidian vault (or ./output/ in dry-run).
 * @param {object} rendered - Keyed by AGENT anchor name, values are markdown strings
 * @param {object} [options]
 * @param {boolean} [options.dryRun]
 * @param {number} [options.sources] - Number of sources that returned ok:true
 * @param {number} [options.items] - Total action items count
 * @returns {Promise<{ ok: boolean, path: string, isNew: boolean }>}
 */
export async function writeDailyNote(rendered, options = {}) {
  const dryRun = options.dryRun ?? isDryRun
  const meta = { sources: options.sources ?? 0, items: options.items ?? 0 }

  const filePath = getDailyNotePath(dryRun)
  const dir = path.dirname(filePath)

  // Ensure output directory exists
  try {
    await fs.mkdir(dir, { recursive: true })
  } catch (err) {
    if (err.code !== 'EEXIST') {
      throw new Error(`[output] Could not create output directory ${dir}: ${err.message}`)
    }
  }

  // Check if vault parent exists (non-dry-run only)
  if (!dryRun) {
    const vaultPath = process.env.OBSIDIAN_VAULT_PATH
    try {
      await fs.access(vaultPath)
    } catch {
      throw new Error(`[output] Vault path not found: ${vaultPath}. Check OBSIDIAN_VAULT_PATH in .env`)
    }
  }

  let existing = null
  try {
    existing = await fs.readFile(filePath, 'utf-8')
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
  }

  let content

  if (!existing) {
    // First run: build from template
    content = buildFromTemplate(rendered, meta)
    console.log(`[output] Creating new daily note: ${filePath}`)
    await fs.writeFile(filePath, content, 'utf-8')
    return { ok: true, path: filePath, isNew: true }
  }

  if (!existing.includes('<!-- AGENT:')) {
    // Manually created note without anchors — append a briefing section
    console.log(`[output] Note exists without anchors — appending brief section`)
    const appendContent = buildFromTemplate(rendered, meta)
    content = existing.trimEnd() + '\n\n## 🤖 Morning Brief\n\n' + appendContent
    await fs.writeFile(filePath, content, 'utf-8')
    return { ok: true, path: filePath, isNew: false }
  }

  // Re-run: smart merge — update each anchor section
  content = existing
  for (const [key, sectionContent] of Object.entries(rendered)) {
    content = updateAnchor(content, key, sectionContent)
  }
  content = updateHeader(content, meta)

  console.log(`[output] Merging into existing daily note: ${filePath}`)
  await fs.writeFile(filePath, content, 'utf-8')
  return { ok: true, path: filePath, isNew: false }
}
