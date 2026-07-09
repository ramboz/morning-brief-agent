#!/usr/bin/env node

/**
 * build-draft-index.js — Generate a unified draft review index for today's brief.
 *
 * Scans {vault}/drafts/ for today's fragment files and reads last-run.json for
 * GitHub pending reviews and Slack DM draft links. Outputs a single Obsidian
 * checklist note ({vault}/drafts/YYYY-MM-DD-index.md) covering all staged drafts.
 *
 * Usage:
 *   node scripts/build-draft-index.js --vault /path/to/vault
 *   node scripts/build-draft-index.js --vault /path/to/vault --state /path/to/last-run.json
 *   node scripts/build-draft-index.js --vault /path/to/vault --date 2026-03-24
 *   node scripts/build-draft-index.js --vault /path/to/vault --dry-run
 *
 * Requires: VAULT_PATH env var or --vault CLI arg.
 *
 * Standalone: node scripts/build-draft-index.js --vault /tmp/vault --dry-run
 * Reference:  docs/decisions/adr-0002-draft-generation-and-delivery.md
 */

import dotenv from 'dotenv'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { envelope } from './lib/config.js'

dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), '.env') })

const TOOL = 'draft_index'
const DEFAULT_STATE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '../skills/morning-assistant/state/last-run.json'
)

/**
 * Parse CLI args.
 * @returns {{ vaultPath: string|null, statePath: string, date: string, dryRun: boolean }}
 */
function parseArgs() {
  const args = process.argv.slice(2)

  const vaultIdx = args.indexOf('--vault')
  const vaultPath = vaultIdx !== -1 ? args[vaultIdx + 1] || null : process.env.VAULT_PATH || null

  const stateIdx = args.indexOf('--state')
  const statePath = stateIdx !== -1 ? args[stateIdx + 1] : DEFAULT_STATE_PATH

  const dateIdx = args.indexOf('--date')
  const date = dateIdx !== -1 ? args[dateIdx + 1] : new Date().toISOString().slice(0, 10)

  const dryRun = args.includes('--dry-run')

  return { vaultPath, statePath, date, dryRun }
}

/**
 * Load last-run.json state, returning empty defaults if missing.
 * @param {string} statePath
 * @returns {Promise<object>}
 */
async function loadState(statePath) {
  try {
    const raw = await readFile(statePath, 'utf-8')
    return JSON.parse(raw)
  } catch {
    return { github_reviews_staged: [], slack_drafts_staged: [] }
  }
}

/**
 * Extract target, URL, and title from a draft fragment file.
 * Parses the heading-based format written by stage-local-draft.js.
 * @param {string} content
 * @returns {{ tool: string, target: string, url: string|null, title: string, context: string }}
 */
function parseDraftFragment(content) {
  const lines = content.split('\n')

  // Line 0: "# Draft: JIRA SITES-1234 comment" or "# Draft: GITHUB owner/repo#1 comment"
  const heading = lines[0] ?? ''
  const headingMatch = heading.match(/^#\s+Draft:\s+(\S+)\s+(.+?)\s+comment$/i)
  const toolFromHeading = headingMatch?.[1]?.toLowerCase() ?? 'unknown'
  const targetFromHeading = headingMatch?.[2] ?? ''

  // Lines like "**Target:** [SITES-1234](https://...) — Title"
  let url = null
  let title = ''
  let context = ''
  let target = targetFromHeading

  for (const line of lines) {
    const targetMatch = line.match(/^\*\*Target:\*\*\s+\[([^\]]+)\]\(([^)]+)\)(?:\s+—\s+(.+))?/)
    if (targetMatch) {
      target = targetMatch[1]
      url = targetMatch[2]
      title = targetMatch[3]?.trim() ?? ''
      continue
    }

    const contextMatch = line.match(/^\*\*Context:\*\*\s+(.+)/)
    if (contextMatch) {
      context = contextMatch[1].trim()
    }
  }

  return { tool: toolFromHeading, target, url, title, context }
}

/**
 * Render the index markdown content.
 * @param {string} date - YYYY-MM-DD
 * @param {object[]} fragments - Parsed local draft fragments
 * @param {object[]} githubReviews - From last-run.json github_reviews_staged
 * @param {object[]} slackDrafts - From last-run.json slack_drafts_staged
 * @param {string} generatedAt - ISO timestamp
 * @returns {string}
 */
function renderIndex(date, fragments, githubReviews, slackDrafts, generatedAt) {
  const time = new Date(generatedAt).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC'
  })

  const totalCount = githubReviews.length + slackDrafts.length + fragments.length
  const parts = []

  parts.push(`# Draft Queue — ${date}`)
  parts.push('')
  parts.push(`> ${totalCount} draft${totalCount !== 1 ? 's' : ''} ready for review · Generated ${time} UTC`)
  parts.push('')
  parts.push('## 📋 Queue')
  parts.push('')

  // GitHub PR reviews
  if (githubReviews.length > 0) {
    parts.push(`### 💻 GitHub PR Reviews (${githubReviews.length})`)
    for (const review of githubReviews) {
      const instance = review.instance === 'corporate' ? 'Corp GitHub' : 'GitHub'
      const prUrl = review.url || buildPrUrl(review)
      const titleText = review.title ? ` — ${review.title}` : ''
      const linkText = prUrl ? ` · [Open PR](${prUrl})` : ''
      parts.push(`- [ ] **${review.owner}/${review.repo}#${review.number}**${titleText}${linkText} · _(${instance} · pending review)_`)
    }
    parts.push('')
  }

  // Slack DM drafts
  if (slackDrafts.length > 0) {
    parts.push(`### 💬 Slack DM Drafts (${slackDrafts.length})`)
    for (const draft of slackDrafts) {
      const dmLink = draft.dm_permalink ? ` · [View in Slack DMs](${draft.dm_permalink})` : ''
      const originalLink = draft.permalink ? ` · [Original thread](${draft.permalink})` : ''
      const summary = draft.summary ? ` — ${draft.summary}` : ''
      parts.push(`- [ ] **${draft.channel}**${summary}${dmLink}${originalLink}`)
    }
    parts.push('')
  }

  // Local MD fragment drafts, grouped by tool
  const jiraFragments = fragments.filter(f => f.tool === 'jira')
  const githubIssueFragments = fragments.filter(f => f.tool === 'github')
  const otherFragments = fragments.filter(f => f.tool !== 'jira' && f.tool !== 'github')

  if (jiraFragments.length > 0) {
    parts.push(`### 🎫 JIRA Comments (${jiraFragments.length})`)
    for (const f of jiraFragments) {
      const wikilink = `[[${f.filename.replace('.md', '')}]]`
      const urlLink = f.url ? ` · [Open ticket](${f.url})` : ''
      const titleText = f.title ? ` — ${f.title}` : ''
      const contextText = f.context && f.context !== 'Draft generated by Morning Assistant' ? ` _(${f.context})_` : ''
      parts.push(`- [ ] **${f.target}**${titleText} · ${wikilink}${urlLink}${contextText}`)
    }
    parts.push('')
  }

  if (githubIssueFragments.length > 0) {
    parts.push(`### 🐛 GitHub Issue Comments (${githubIssueFragments.length})`)
    for (const f of githubIssueFragments) {
      const wikilink = `[[${f.filename.replace('.md', '')}]]`
      const urlLink = f.url ? ` · [Open issue](${f.url})` : ''
      const titleText = f.title ? ` — ${f.title}` : ''
      parts.push(`- [ ] **${f.target}**${titleText} · ${wikilink}${urlLink}`)
    }
    parts.push('')
  }

  if (otherFragments.length > 0) {
    parts.push(`### 📝 Other Drafts (${otherFragments.length})`)
    for (const f of otherFragments) {
      const wikilink = `[[${f.filename.replace('.md', '')}]]`
      const urlLink = f.url ? ` · [Open](${f.url})` : ''
      parts.push(`- [ ] **${f.target}** · ${wikilink}${urlLink}`)
    }
    parts.push('')
  }

  if (totalCount === 0) {
    parts.push('_No drafts staged for today._')
    parts.push('')
  }

  parts.push('---')
  parts.push(`*Generated at ${time} UTC · Morning Assistant v2*`)
  parts.push('')

  return parts.join('\n')
}

/**
 * Build a PR URL from review metadata when url field is absent.
 * @param {object} review
 * @returns {string|null}
 */
function buildPrUrl(review) {
  if (!review.owner || !review.repo || !review.number) return null
  const base = review.instance === 'corporate'
    ? process.env.GITHUB_CORP_BASE_URL?.replace('/api/v3', '') ?? 'https://github.example.com'
    : 'https://github.com'
  return `${base}/${review.owner}/${review.repo}/pull/${review.number}`
}

async function main() {
  const { vaultPath, statePath, date, dryRun } = parseArgs()

  if (!vaultPath) {
    console.log(JSON.stringify(envelope(TOOL, 'index', null, [
      'VAULT_PATH not set — set env var or pass --vault /path/to/vault'
    ])))
    return
  }

  const draftsDir = join(vaultPath, 'drafts')
  const indexFilename = `${date}-index.md`
  const indexPath = join(draftsDir, indexFilename)

  // Load state for GitHub reviews and Slack DMs
  const state = await loadState(statePath)
  const githubReviews = (state.github_reviews_staged ?? []).filter(r => {
    // Only include reviews staged today (timestamp within 24h)
    if (!state.timestamp) return true
    const stateDate = new Date(state.timestamp).toISOString().slice(0, 10)
    return stateDate === date
  })
  const slackDrafts = state.slack_drafts_staged ?? []

  // Scan drafts directory for today's fragment files
  let fragments = []
  try {
    const files = await readdir(draftsDir)
    const todayFiles = files.filter(f =>
      f.startsWith(date) &&
      f.endsWith('.md') &&
      f !== indexFilename
    )

    for (const filename of todayFiles) {
      try {
        const content = await readFile(join(draftsDir, filename), 'utf-8')
        const parsed = parseDraftFragment(content)
        fragments.push({ ...parsed, filename })
      } catch (err) {
        console.error(`[${TOOL}] Could not parse ${filename}: ${err.message}`)
      }
    }
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error(`[${TOOL}] Could not read drafts dir: ${err.message}`)
    }
    // No drafts directory yet — that's fine, fragments stays []
  }

  const generatedAt = new Date().toISOString()
  const content = renderIndex(date, fragments, githubReviews, slackDrafts, generatedAt)
  const totalCount = githubReviews.length + slackDrafts.length + fragments.length

  if (dryRun) {
    console.error(`[${TOOL}] Dry run — would write ${indexPath}:`)
    console.error(content)
  } else {
    try {
      await mkdir(draftsDir, { recursive: true })
      await writeFile(indexPath, content, 'utf-8')
      console.error(`[${TOOL}] Written: ${indexPath}`)
    } catch (err) {
      console.log(JSON.stringify(envelope(TOOL, 'index', null, [err.message])))
      return
    }
  }

  console.log(JSON.stringify(envelope(TOOL, 'index', {
    written: !dryRun,
    filePath: indexPath,
    filename: indexFilename,
    date,
    counts: {
      githubReviews: githubReviews.length,
      slackDrafts: slackDrafts.length,
      localFragments: fragments.length,
      total: totalCount
    }
  })))
}

main().catch(err => {
  console.error(`[${TOOL}]`, err.message)
  console.log(JSON.stringify(envelope(TOOL, 'index', null, [err.message])))
})
