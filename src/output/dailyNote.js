import 'dotenv/config'
import fs from 'fs/promises'
import path from 'path'
import { outputPath, lookbackHours } from '../utils/flags.js'

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
  if (!dateStr) return null
  const diff = Date.now() - new Date(dateStr).getTime()
  const hours = Math.floor(diff / (60 * 60 * 1000))
  if (hours < 1) return 'just now'
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

/**
 * Splits items into Today / Yesterday / Earlier buckets based on a timestamp accessor.
 * @param {object[]} items
 * @param {(item: object) => string|null} getTimestamp - Returns an ISO date string or null
 * @returns {{ today: object[], yesterday: object[], earlier: object[] }}
 */
function groupByRecency(items, getTimestamp) {
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterdayStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000)

  const today = []
  const yesterday = []
  const earlier = []

  for (const item of items) {
    const ts = getTimestamp(item)
    if (!ts) { earlier.push(item); continue }
    const date = new Date(ts)
    if (date >= todayStart) today.push(item)
    else if (date >= yesterdayStart) yesterday.push(item)
    else earlier.push(item)
  }

  return { today, yesterday, earlier }
}

/**
 * Wraps a render function with Today/Yesterday/Earlier sub-headers when lookback > 72h.
 * Passes through to renderFn unchanged when lookback is short or items don't span multiple days.
 * @param {object[]} items - Items to render
 * @param {(item: object) => string|null} getTimestamp - Timestamp accessor per item
 * @param {(items: object[]) => string} renderFn - Render function for a flat item list
 * @returns {string} Markdown output, optionally with recency sub-headers
 */
export function withRecencyGrouping(items, getTimestamp, renderFn) {
  if (lookbackHours <= 72 || !items || items.length === 0) return renderFn(items)

  const { today, yesterday, earlier } = groupByRecency(items, getTimestamp)

  const nonEmpty = [today, yesterday, earlier].filter(g => g.length > 0)
  if (nonEmpty.length <= 1) return renderFn(items)

  const parts = []
  if (today.length > 0) parts.push(`#### Today\n${renderFn(today)}`)
  if (yesterday.length > 0) parts.push(`#### Yesterday\n${renderFn(yesterday)}`)
  if (earlier.length > 0) parts.push(`#### Earlier\n${renderFn(earlier)}`)

  return parts.join('\n\n')
}

/**
 * Returns the full path to today's daily note.
 * Resolved from: --output flag > OUTPUT_PATH env > ./output (default).
 * @returns {string}
 */
export function getDailyNotePath() {
  return path.join(outputPath, `${formatDate()}.md`)
}

// ---------------------------------------------------------------------------
// Section renderers
// ---------------------------------------------------------------------------

/**
 * Renders the JIRA "Needs Your Input" section content (actionRequired items).
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
 * Renders the Confluence "Pages Needing Attention" section content.
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
 * Renders the Slack "Mentions & Threads" section content.
 * Only shows items where needsReply is true — resolved threads are filtered out.
 * @param {object[]} mentions - From summarizeSlackMentions()
 * @returns {string}
 */
export function renderSlackMentions(mentions) {
  const actionable = (mentions ?? []).filter(m => m.needsReply)
  if (actionable.length === 0) return '_Nothing to report._'

  return actionable.map(m => {
    const link = m.permalink ? `[#${m.channelName}](${m.permalink})` : `#${m.channelName}`
    const user = m.user.startsWith('@') ? m.user : `@${m.user}`
    return `- 🔴 **${link}** — ${user}: ${m.summary}`
  }).join('\n')
}

/**
 * Renders the Slack "Thread Updates" section content.
 * These are threads the user participated in that have new replies from others.
 * @param {object[]} threads - From summarizeSlackThreads()
 * @param {string} [workspaceUrl] - Slack workspace URL for deep links
 * @returns {string}
 */
export function renderSlackThreads(threads, workspaceUrl) {
  if (!threads || threads.length === 0) return '_Nothing to report._'

  const base = workspaceUrl ? workspaceUrl.replace(/\/$/, '') : null

  return threads.map(t => {
    const icon = t.needsReply ? '🔴' : 'ℹ️'
    const threadLink = base && t.channelId && t.threadTs
      ? `[#${t.channelName}](${base}/archives/${t.channelId}/p${t.threadTs.replace('.', '')})`
      : `#${t.channelName}`
    return `- ${icon} **${threadLink}** _(re: ${t.parentText})_ — ${t.summary}`
  }).join('\n')
}

/**
 * Renders the Slack "Direct Messages" section content.
 * @param {object[]} dms - From summarizeSlackDMs()
 * @param {string} [workspaceUrl] - Slack workspace URL for deep links
 * @returns {string}
 */
export function renderSlackDMs(dms, workspaceUrl) {
  if (!dms || dms.length === 0) return '_Nothing to report._'

  const base = workspaceUrl ? workspaceUrl.replace(/\/$/, '') : null

  return dms.map(dm => {
    const icon = dm.replyExpected ? '🔴' : 'ℹ️'
    const userLink = base && dm.dmChannelId
      ? `[${dm.withUser}](${base}/archives/${dm.dmChannelId})`
      : dm.withUser
    return `- ${icon} **${userLink}** — ${dm.summary}`
  }).join('\n')
}

/**
 * Renders priority channel summaries as a markdown block with deep links.
 * Channels and per-bullet thread links are constructed from channelId + ts in the AI output.
 * @param {object[]} channels - From summarizeSlackChannels()
 * @param {string} [workspaceUrl] - Slack workspace URL (e.g. https://myteam.slack.com/)
 * @returns {string}
 */
export function renderSlackChannels(channels, workspaceUrl) {
  if (!channels || channels.length === 0) return '_Nothing to report._'

  const base = workspaceUrl ? workspaceUrl.replace(/\/$/, '') : null

  // Merge bullets for duplicate channel entries (same channel name from multiple AI outputs)
  const seen = new Map()
  const deduped = []
  for (const ch of channels) {
    const key = ch.channel.replace(/^#/, '').toLowerCase()
    if (seen.has(key)) {
      seen.get(key).bullets.push(...(ch.bullets ?? []))
    } else {
      const entry = { ...ch, bullets: [...(ch.bullets ?? [])] }
      seen.set(key, entry)
      deduped.push(entry)
    }
  }

  const parts = deduped.map(ch => {
    const channelLink = base && ch.channelId
      ? `[#${ch.channel}](${base}/archives/${ch.channelId})`
      : `#${ch.channel}`

    const bullets = (ch.bullets ?? []).map(b => {
      // b is either a string (legacy) or { text, ts }
      const text = typeof b === 'string' ? b : b.text
      const ts = typeof b === 'object' ? b.ts : null
      const threadLink = base && ch.channelId && ts
        ? ` [↗](${base}/archives/${ch.channelId}/p${ts.replace('.', '')})`
        : ''
      return `- ${text}${threadLink}`
    }).join('\n')

    return bullets ? `#### ${channelLink}\n${bullets}` : null
  }).filter(Boolean)

  return parts.length > 0 ? parts.join('\n\n') : '_Nothing to report._'
}

/**
 * Renders the Slack "Other Channels" section content.
 * @param {{ totalChannelsWithActivity: number, mentionCount: number }} activity
 * @returns {string}
 */
export function renderSlackOther(activity) {
  if (!activity || activity.totalChannelsWithActivity === 0) return '_No activity in other channels._'

  const mentionNote = activity.mentionCount > 0
    ? ` ${activity.mentionCount} mention(s) already listed above.`
    : ' No mentions.'

  return `_${activity.totalChannelsWithActivity} other channel(s) had activity.${mentionNote}_`
}

/**
 * Renders the ⚡ Action Items section from synthesizeActionItems() output.
 * Items with a URL, permalink, or channelId+ts have their reference portion linked.
 * Expects text in the form "Reference — description" to extract the link label.
 * @param {Array<{ source: string, text: string, url: string, permalink: string, channelId: string, ts: string }>} items
 * @param {string} [workspaceUrl] - Slack workspace base URL for channelId+ts deep links
 * @returns {string}
 */
export function renderActionItems(items, workspaceUrl) {
  if (!items || items.length === 0) return '_Nothing to report._'

  const base = workspaceUrl ? workspaceUrl.replace(/\/$/, '') : null

  return items.map(item => {
    let link = item.url || item.permalink || ''
    if (!link && base && item.channelId && item.ts) {
      link = `${base}/archives/${item.channelId}/p${item.ts.replace('.', '')}`
    }

    const sep = item.text.indexOf(' — ')
    if (link && sep !== -1) {
      const ref = item.text.slice(0, sep)
      const desc = item.text.slice(sep + 3)
      return `- [ ] [${item.source}] [${ref}](${link}) — ${desc}`
    }
    if (link) {
      return `- [ ] [${item.source}] [${item.text}](${link})`
    }
    return `- [ ] [${item.source}] ${item.text}`
  }).join('\n')
}

/**
 * Renders the 🔥 Focus Areas section from synthesizeProjectClusters() output.
 * Each cluster is a ### heading followed by source-tagged bullet lines.
 * @param {Array<{ name: string, signals: Array<{ source: string, summary: string, url: string }> }>} clusters
 * @returns {string}
 */
export function renderProjectClusters(clusters) {
  if (!clusters || clusters.length === 0) return '_No cross-source patterns today._'

  return clusters.map(cluster => {
    const signals = cluster.signals.map(signal => {
      if (signal.url) return `- [${signal.source}] [${signal.summary}](${signal.url})`
      return `- [${signal.source}] ${signal.summary}`
    }).join('\n')
    return `### ${cluster.name}\n${signals}`
  }).join('\n\n')
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
    const numMatch = item.url?.match(/\/(pull|issues)\/(\d+)$/)
    const ref = numMatch ? `${item.repo} #${numMatch[2]}` : item.repo
    let line = `- ${icon} **[${ref}](${item.url})** — ${item.title}`
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

## 🔥 Focus Areas
<!-- AGENT:focus_areas -->
{focus_areas}

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
{slack_mentions}

### Thread Updates
<!-- AGENT:slack_threads -->
{slack_threads}

### Direct Messages
<!-- AGENT:slack_dms -->
{slack_dms}

### Priority Channels
<!-- AGENT:slack_channels -->
{slack_channels}

### Other Channels
<!-- AGENT:slack_other -->
{slack_other}

## 💬 Yesterday's Meetings
<!-- AGENT:meetings -->
_Nothing to report._

## 💬 Teams Activity
### Mentions & Replies
<!-- AGENT:teams_activity -->
_Nothing to report._

## 🎫 JIRA
### Needs Your Input
<!-- AGENT:jira_tickets -->
{jira_tickets}

### Discussions to Join
<!-- AGENT:jira_discussions -->
{jira_discussions}

## 📖 Wiki
### Pages Needing Attention
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
/**
 * Replaces bare JIRA ticket keys (e.g. SITES-40610) with markdown links to the JIRA instance.
 * Skips keys that are already inside a markdown link to avoid double-linking.
 * @param {string} text
 * @returns {string}
 */
function linkJiraRefs(text) {
  const jiraBase = (process.env.JIRA_BASE_URL ?? '').replace(/\/$/, '')
  if (!jiraBase) return text
  // Match JIRA keys not already used as link text [KEY] or inside a URL (browse/KEY)
  return text.replace(/(?<!\[|\/)\b([A-Z][A-Z0-9_]+-\d+)\b(?!\])/g, (match, key) =>
    `[${key}](${jiraBase}/browse/${key})`
  )
}

function buildFromTemplate(rendered, meta) {
  const now = new Date()
  const content = DAILY_BRIEF_TEMPLATE
    .replace('{DATE}', formatDate(now))
    .replace('{TIME}', formatTime(now))
    .replace('{SOURCES}', String(meta.sources ?? 0))
    .replace('{ITEMS}', String(meta.items ?? 0))
    .replace('{action_items}', rendered.action_items ?? '_Nothing to report._')
    .replace('{focus_areas}', rendered.focus_areas ?? '_No cross-source patterns today._')
    .replace('{slack_mentions}', rendered.slack_mentions ?? '_Nothing to report._')
    .replace('{slack_threads}', rendered.slack_threads ?? '_Nothing to report._')
    .replace('{slack_dms}', rendered.slack_dms ?? '_Nothing to report._')
    .replace('{slack_channels}', rendered.slack_channels ?? '_Nothing to report._')
    .replace('{slack_other}', rendered.slack_other ?? '_No activity in other channels._')
    .replace('{jira_tickets}', rendered.jira_tickets ?? '_Nothing to report._')
    .replace('{jira_discussions}', rendered.jira_discussions ?? '_Nothing to report._')
    .replace('{confluence}', rendered.confluence ?? '_Nothing to report._')
    .replace('{github_com}', rendered.github_com ?? '_Nothing to report._')
    .replace('{github_corp}', rendered.github_corp ?? '_Nothing to report._')
  return linkJiraRefs(content)
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
    // End just before the next anchor — but preserve any markdown heading (###) on the
    // line immediately before the anchor (e.g. "### Other Channels\n<!-- AGENT:next -->").
    // content[nextAnchorIdx - 1] is the \n right before <!-- AGENT: -->, so we look
    // one step further back to get the actual preceding line.
    const nlBeforeAnchor = nextAnchorIdx - 1
    const nlBeforeLine = content.lastIndexOf('\n', nlBeforeAnchor - 1)
    const prevLine = nlBeforeLine >= 0 ? content.slice(nlBeforeLine + 1, nlBeforeAnchor) : ''
    if (prevLine.trimEnd().startsWith('#')) {
      endIdx = nlBeforeLine  // preserve heading — slice picks it up from here
    } else {
      endIdx = nlBeforeAnchor
    }
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
 * Writes or smart-merges the daily note to the configured output directory.
 * Output path resolved from: --output flag > OUTPUT_PATH env > ./output (default).
 * @param {object} rendered - Keyed by AGENT anchor name, values are markdown strings
 * @param {object} [options]
 * @param {number} [options.sources] - Number of sources that returned ok:true
 * @param {number} [options.items] - Total action items count
 * @returns {Promise<{ ok: boolean, path: string, isNew: boolean }>}
 */
export async function writeDailyNote(rendered, options = {}) {
  const meta = { sources: options.sources ?? 0, items: options.items ?? 0 }

  const filePath = getDailyNotePath()
  const dir = path.dirname(filePath)

  // Ensure output directory exists
  try {
    await fs.mkdir(dir, { recursive: true })
  } catch (err) {
    if (err.code !== 'EEXIST') {
      throw new Error(`[output] Could not create output directory ${dir}: ${err.message}`)
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
  content = linkJiraRefs(content)

  console.log(`[output] Merging into existing daily note: ${filePath}`)
  await fs.writeFile(filePath, content, 'utf-8')
  return { ok: true, path: filePath, isNew: false }
}
