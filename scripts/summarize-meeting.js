#!/usr/bin/env node

/**
 * summarize-meeting.js — Generate Obsidian meeting notes from multiple sources.
 *
 * Sources:
 *   1. SharePoint .vtt transcripts (Teams meeting recordings)
 *   2. Email recaps (meeting notes/recordings sent by external parties)
 *
 * Modes:
 *   --brief              Process all transcripts + recap emails from the lookback window
 *   --search "query"     Find and process transcripts/emails matching a search query
 *   --dry-run            Show what would be written without creating files
 *   --list               List available sources without processing
 *
 * Standalone: node scripts/summarize-meeting.js --brief
 *             node scripts/summarize-meeting.js --search "sprint planning"
 *             node scripts/summarize-meeting.js --list
 */

import dotenv from 'dotenv'
import { dirname, join, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeFile, readdir, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { execFile as execFileCb } from 'node:child_process'
import { promisify } from 'node:util'
import { parseArgs, envelope, loadConfig } from './lib/config.js'
import { getGraphToken, graphFetch, graphPost, graphDownload } from './lib/graphAuth.js'

const execFile = promisify(execFileCb)

dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), '..', '.env') })

const TOOL = 'meeting-summary'
const GRAPH = 'https://graph.microsoft.com/v1.0'

// ── Config (loaded in main, defaults used if config missing) ────────────────
let CONFIG = {}
const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude'
const CLAUDE_TIMEOUT_MS = parseInt(process.env.AI_TIMEOUT_MS, 10) || 120_000

/** Resolve vault meetings folder from config + env. */
function getVaultMeetings() {
  const vaultBase = process.env.VAULT_PATH || CONFIG.vault_path || ''
  const subfolder = CONFIG.vault_meetings_folder || 'Meetings'
  return join(vaultBase, subfolder)
}

/** Resolve model from config + env. */
function getModel() {
  return process.env.MEETING_SUMMARY_MODEL || CONFIG.model || 'claude-sonnet-4-20250514'
}

/** Max transcript chars from config. */
function getMaxChars() {
  return CONFIG.max_transcript_chars || 200_000
}

// ── Transcript search ────────────────────────────────────────────────────────

/**
 * Search SharePoint for meeting transcript files (.vtt and Copilot .docx).
 * Teams stores transcripts in two formats:
 * - .vtt files: WebVTT captions with timestamps and speaker labels
 * - .docx files: Copilot-generated transcript (same content, docx format)
 *   Pattern: {Title}-{YYYYMMDD_HHMMSS}-Meeting Recording-{locale}.docx
 *
 * @param {string} token
 * @param {string} query - Search query
 * @param {number} maxResults
 * @returns {Promise<object[]>}
 */
async function findTranscripts(token, query, maxResults = 20) {
  const result = await graphPost(token, `${GRAPH}/search/query`, {
    requests: [{
      entityTypes: ['driveItem'],
      query: { queryString: query },
      from: 0,
      size: maxResults,
    }],
  })

  const hits = result.value?.[0]?.hitsContainers?.[0]?.hits ?? []
  return hits.map(hit => ({
    name: hit.resource?.name ?? '',
    webUrl: hit.resource?.webUrl ?? '',
    size: hit.resource?.size ?? 0,
    createdAt: hit.resource?.createdDateTime ?? '',
    modifiedAt: hit.resource?.lastModifiedDateTime ?? '',
    createdBy: hit.resource?.createdBy?.user?.displayName ?? '',
    driveItemId: hit.resource?.id ?? '',
    driveId: hit.resource?.parentReference?.driveId ?? '',
    summary: (hit.summary ?? '').replace(/<[^>]+>/g, '').slice(0, 200),
  }))
}

// ── Email recap search ──────────────────────────────────────────────────────

/**
 * Search for emails that contain meeting notes/recaps using Graph search API.
 * @param {string} token
 * @param {string[]} keywords - Subject keywords to match
 * @param {number} lookbackHours
 * @returns {Promise<object[]>}
 */
async function findMeetingRecapEmails(token, keywords, lookbackHours = 48) {
  const since = new Date(Date.now() - lookbackHours * 3600_000).toISOString().slice(0, 10)
  // Build KQL query: subject contains any keyword AND received recently
  // Use individual words (not exact phrases) so "Meeting Recoding and Notes" matches "meeting notes"
  const subjectClauses = keywords.map(k => {
    const words = k.split(/\s+/).filter(w => w.length > 2)
    return `(${words.map(w => `subject:${w}`).join(' AND ')})`
  }).join(' OR ')
  const queryString = `(${subjectClauses}) AND received>=${since}`

  console.error(`[meeting] Searching recap emails: ${queryString}`)

  const result = await graphPost(token, `${GRAPH}/search/query`, {
    requests: [{
      entityTypes: ['message'],
      query: { queryString },
      from: 0,
      size: 20,
    }],
  })

  const hits = result.value?.[0]?.hitsContainers?.[0]?.hits ?? []
  return hits.map(hit => ({
    id: hit.hitId ?? hit.resource?.id ?? '',
    subject: hit.resource?.subject ?? '',
    from: hit.resource?.from?.emailAddress?.name ?? hit.resource?.sender?.emailAddress?.name ?? '',
    fromEmail: hit.resource?.from?.emailAddress?.address ?? '',
    receivedAt: hit.resource?.receivedDateTime ?? '',
    webLink: hit.resource?.webLink ?? '',
    summary: (hit.summary ?? '').replace(/<[^>]+>/g, '').slice(0, 200),
  }))
}

/**
 * Fetch the full body of an email, returning plain text.
 * @param {string} token
 * @param {string} messageId
 * @returns {Promise<string>}
 */
async function fetchEmailBody(token, messageId) {
  const msg = await graphFetch(token,
    `${GRAPH}/me/messages/${messageId}?$select=body,from,toRecipients,ccRecipients`)
  const html = msg.body?.content ?? ''
  // Strip HTML to plain text
  const bodyText = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#\d+;/g, '')
    .replace(/\s+/g, ' ').trim()

  // Prepend sender/recipient info so Claude can detect attendees and companies
  const fmt = (r) => `${r.emailAddress?.name ?? ''} <${r.emailAddress?.address ?? ''}>`
  const from = msg.from ? fmt(msg.from) : ''
  const to = (msg.toRecipients || []).map(fmt).join(', ')
  const cc = (msg.ccRecipients || []).map(fmt).join(', ')
  const header = [
    from && `From: ${from}`,
    to && `To: ${to}`,
    cc && `CC: ${cc}`,
  ].filter(Boolean).join('\n')

  return header ? `${header}\n\n${bodyText}` : bodyText
}

/**
 * Process recap emails: fetch body, summarize, write notes.
 * @param {string} token
 * @param {object[]} emails
 * @param {Set<string>} existing - Existing note filenames
 * @param {object} options
 * @returns {Promise<{processed: object[], skipped: object[], errors: string[]}>}
 */
async function processRecapEmails(token, emails, existing, { dryRun = false } = {}) {
  const errors = []
  const processed = []
  const skipped = []
  const vaultDir = getVaultMeetings()

  console.error(`[meeting] Processing ${emails.length} recap emails`)

  for (const email of emails) {
    const label = email.subject.slice(0, 60)
    try {
      // Fetch full email body
      console.error(`[meeting] Fetching email body: "${label}"...`)
      const bodyText = await fetchEmailBody(token, email.id)

      if (!bodyText || bodyText.length < 200) {
        console.error(`[meeting] Skipping "${label}" — body too short (${bodyText?.length ?? 0} chars)`)
        skipped.push({ name: email.subject, source: 'email', reason: 'body too short' })
        continue
      }

      console.error(`[meeting] Email body: ${(bodyText.length / 1024).toFixed(0)}KB — summarizing with Claude...`)

      // Summarize with Claude (email mode)
      const summary = await summarizeWithClaude(bodyText, email.subject, 'email')

      // Fix date if Claude couldn't extract it — fall back to email received date
      if (!summary.date || summary.date.includes('XX') || summary.date === 'unknown') {
        const d = new Date(email.receivedAt)
        summary.date = `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)}`
      }

      // Use Claude's extracted date for filename (meeting date, not email received date)
      const meetingDate = summary.date?.slice(0, 10) || email.receivedAt
      const filename = noteFilename(meetingDate, summary.title || email.subject)
      if (existing.has(filename)) {
        console.error(`[meeting] Skipping "${filename}" — already exists`)
        skipped.push({ name: email.subject, source: 'email', reason: 'note exists', filename })
        continue
      }

      // Generate note
      const note = formatMeetingNote(summary)
      const notePath = join(vaultDir, filename)

      if (dryRun) {
        console.error(`[meeting] DRY RUN — would write: ${filename}`)
        console.error('--- preview ---')
        console.error(note.slice(0, 500))
        console.error('--- end preview ---')
      } else {
        await writeFile(notePath, note, 'utf-8')
        console.error(`[meeting] Wrote: ${notePath}`)
      }

      processed.push({
        source: 'email',
        email: email.subject,
        from: email.from,
        noteFile: filename,
        title: summary.title,
        date: summary.date,
        attendees: summary.attendees?.length ?? 0,
        actionItems: summary.actionItems?.length ?? 0,
        dryRun,
      })
    } catch (err) {
      console.error(`[meeting] Error processing email "${label}":`, err.message)
      errors.push(`email:${label}: ${err.message}`)
    }
  }

  return { processed, skipped, errors }
}

// ── Dedup against existing notes ─────────────────────────────────────────────

/**
 * Get list of existing meeting note filenames to avoid duplicates.
 * @returns {Promise<Set<string>>}
 */
async function getExistingNotes() {
  try {
    const files = await readdir(getVaultMeetings())
    return new Set(files.filter(f => f.endsWith('.md')))
  } catch {
    return new Set()
  }
}

/**
 * Derive the expected note filename from a date and title.
 * @param {string} dateStr - ISO date string (e.g. "2026-03-20T10:00:00Z")
 * @param {string} meetingTitle - Cleaned title
 * @returns {string} e.g. "2026-03-20 - Sprint Planning.md"
 */
function noteFilename(dateStr, meetingTitle) {
  const date = (dateStr || new Date().toISOString()).slice(0, 10)
  // Clean title for filename
  const clean = meetingTitle
    .replace(/[/\\:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
  return `${date} - ${clean}.md`
}

// ── Claude summarization ─────────────────────────────────────────────────────

/**
 * Send text content to Claude and get a structured meeting summary.
 * @param {string} transcriptText - Full .vtt content or email body text
 * @param {string} transcriptName - File name or email subject for context
 * @param {'transcript'|'email'} sourceType - Content source type
 * @returns {Promise<object>} { title, date, attendees, tags, summary, actionItems }
 */
async function summarizeWithClaude(transcriptText, transcriptName, sourceType = 'transcript') {
  const maxChars = getMaxChars()
  // Truncate very long transcripts
  const text = transcriptText.length > maxChars
    ? transcriptText.slice(0, maxChars) + '\n\n[... transcript truncated ...]'
    : transcriptText

  // Build tag list from config
  const projectTags = CONFIG.project_tags || {}
  const tagLines = Object.entries(projectTags)
    .map(([code, desc]) => `   - ${code.padEnd(16)}— ${desc}`)
    .join('\n')
  const tagInstruction = Object.keys(projectTags).length > 0
    ? `4. Identify 1-3 relevant project tags from the ALLOWED LIST ONLY:\n${tagLines}\n   Do NOT invent tags. If no project tag clearly fits, return an empty tags array.`
    : '4. Identify 1-3 relevant short lowercase project tags from the meeting content. Use concise codes (e.g. "infra", "auth", "onboarding").'

  // Build customer detection from config
  const employer = CONFIG.employer || 'your company'
  const knownCustomers = CONFIG.known_customers || []
  const customerHint = knownCustomers.length > 0
    ? `Known customers: ${knownCustomers.join(', ')}.`
    : ''
  const customerInstruction = `5. Detect external companies (non-${employer} attendees or customer orgs mentioned).
   ${customerHint}
   If a NEW external company is discussed, include it too.
   Set "customer" to the company name (e.g. ${knownCustomers.slice(0, 2).map(c => `"${c}"`).join(', ') || '"Acme Corp"'}), or null for internal-only meetings.`

  const sourceLabel = sourceType === 'email' ? 'EMAIL SUBJECT' : 'TRANSCRIPT FILE'
  const sourceIntro = sourceType === 'email'
    ? 'Given an email containing meeting notes or a recap, produce a structured summary. The email may contain AI-generated notes, manual notes, or a mix of both.'
    : 'Given a meeting transcript, produce a structured summary.'

  const prompt = `You are a meeting notes assistant. ${sourceIntro}

${sourceLabel}: ${transcriptName}

INSTRUCTIONS:
1. Extract the meeting title from context (clean it up — remove dates, recording suffixes, etc.)
2. Extract the date (from timestamps or filename)
3. List all attendees (full names where possible)
${tagInstruction}
${customerInstruction}
6. Write a concise summary using nested bullet points:
   - Top-level bullets for main topics discussed
   - Sub-bullets for key details, decisions, and context
   - Keep it conversational and concise (not formal/corporate)
   - Capture decisions and important context, skip small talk
7. Extract action items as a checkbox list
   - Include who is responsible if mentioned
   - Include deadlines if mentioned

OUTPUT FORMAT (strict JSON):
{
  "title": "Meeting Title",
  "date": "YYYY-MM-DD HH:MM",
  "attendees": ["Name 1", "Name 2"],
  "tags": ["project-code"],
  "customer": null,
  "summary": "- Topic 1\\n  - Detail\\n  - Detail\\n- Topic 2\\n  - Detail",
  "actionItems": ["Action item 1", "Action item 2"]
}

Rules:${Object.keys(projectTags).length > 0 ? '\n- "tags" must ONLY contain values from the allowed list above. Never invent new tags.' : ''}
- "customer" must be the company name as a plain string (e.g. "SAP"), or null for internal meetings.
- If no action items are found, return an empty array.
- Return ONLY the JSON object, no markdown fencing.

${sourceType === 'email' ? 'EMAIL BODY' : 'TRANSCRIPT'}:
${text}`

  // Unset CLAUDECODE to allow spawning from within a Claude Code session
  const env = { ...process.env }
  delete env.CLAUDECODE

  // Pipe prompt via stdin (too long for CLI args)
  const { spawn } = await import('node:child_process')
  const stdout = await new Promise((resolve, reject) => {
    const proc = spawn(CLAUDE_BIN, [
      '--print',
      '--output-format', 'text',
      '--permission-mode', 'bypassPermissions',
      '--model', getModel(),
      '-p', '-',
    ], { env, timeout: CLAUDE_TIMEOUT_MS })

    let out = ''
    let err = ''
    proc.stdout.on('data', d => { out += d })
    proc.stderr.on('data', d => { err += d })
    proc.on('close', code => {
      if (code !== 0) reject(new Error(`claude exited ${code}: ${err.slice(0, 300)}`))
      else resolve(out)
    })
    proc.on('error', reject)
    proc.stdin.write(prompt)
    proc.stdin.end()
  })

  // Extract JSON from response
  const jsonStart = stdout.indexOf('{')
  const jsonEnd = stdout.lastIndexOf('}')
  if (jsonStart === -1 || jsonEnd === -1) {
    throw new Error('Claude response did not contain JSON')
  }
  return JSON.parse(stdout.slice(jsonStart, jsonEnd + 1))
}

// ── Obsidian note generation ─────────────────────────────────────────────────

/**
 * Format a meeting summary as an Obsidian-compatible markdown note.
 * @param {object} summary - Output from summarizeWithClaude
 * @returns {string} Markdown content
 */
function formatMeetingNote(summary) {
  const tags = ['project', 'meeting', ...(summary.tags || [])]
    .map(t => `  - ${t}`)
    .join('\n')

  const attendees = (summary.attendees || [])
    .map(name => `- ${name}`)
    .join('\n')

  const actionItems = (summary.actionItems || []).length > 0
    ? summary.actionItems.map(item => `- [ ] ${item}`).join('\n')
    : '- [ ] '

  const customer = summary.customer
    ? `\ncustomer: "[[${summary.customer}]]"`
    : ''

  return `---
date: ${summary.date || new Date().toISOString().slice(0, 16).replace('T', ' ')}
tags:
${tags}
type: meeting${customer}
---

## Attendees

${attendees}

## Summary

${summary.summary}

## Action items

${actionItems}
`
}

// ── Modes ────────────────────────────────────────────────────────────────────

/**
 * List available transcripts and recap emails without processing.
 * @param {string} token
 * @param {object[]} transcripts - Pre-fetched transcripts
 * @param {object[]} recapEmails - Pre-fetched recap emails
 */
async function runList(token, transcripts, recapEmails = []) {
  const existing = await getExistingNotes()

  console.error(`[meeting] Listing ${transcripts.length} transcripts`)
  for (const t of transcripts) {
    const guessTitle = t.name.replace(/\.vtt$/, '').replace(/-\d{8}_\d{6}-Meeting Recording/, '')
    const fname = noteFilename(t.createdAt || t.modifiedAt, guessTitle)
    const exists = existing.has(fname) ? ' [EXISTS]' : ''
    console.error(`  [VTT]   ${t.createdAt.slice(0, 10)} | ${t.name} (${(t.size / 1024).toFixed(0)}KB)${exists}`)
  }

  if (recapEmails.length > 0) {
    console.error(`[meeting] Listing ${recapEmails.length} recap emails`)
    for (const e of recapEmails) {
      const fname = noteFilename(e.receivedAt, e.subject)
      const exists = existing.has(fname) ? ' [EXISTS]' : ''
      console.error(`  [EMAIL] ${e.receivedAt.slice(0, 10)} | ${e.from}: ${e.subject.slice(0, 60)}${exists}`)
    }
  }

  return { transcripts, recapEmails, count: transcripts.length + recapEmails.length }
}

/**
 * Process transcripts: download, summarize, write notes.
 * @param {string} token
 * @param {object[]} transcripts - Pre-fetched transcripts
 * @param {object} options
 * @returns {Promise<object>}
 */
async function runProcess(token, transcripts, { dryRun = false, existing = null } = {}) {
  const errors = []
  if (!existing) existing = await getExistingNotes()
  const vaultDir = getVaultMeetings()

  console.error(`[meeting] Processing ${transcripts.length} transcripts`)

  // Ensure output directory exists
  if (!dryRun && !existsSync(vaultDir)) {
    await mkdir(vaultDir, { recursive: true })
    console.error(`[meeting] Created directory: ${vaultDir}`)
  }

  const processed = []
  const skipped = []

  for (const transcript of transcripts) {
    const label = transcript.name.replace(/\.vtt$/, '')
    try {
      // Skip if no driveId/itemId
      if (!transcript.driveId || !transcript.driveItemId) {
        console.error(`[meeting] Skipping "${label}" — missing drive info`)
        skipped.push({ name: transcript.name, reason: 'missing drive info' })
        continue
      }

      // Download transcript content
      console.error(`[meeting] Downloading "${label}"...`)
      const content = await graphDownload(token, transcript.driveId, transcript.driveItemId)

      if (!content || content.length < 100) {
        console.error(`[meeting] Skipping "${label}" — too short (${content?.length ?? 0} chars)`)
        skipped.push({ name: transcript.name, reason: 'content too short' })
        continue
      }

      console.error(`[meeting] Downloaded ${(content.length / 1024).toFixed(0)}KB — summarizing with Claude...`)

      // Summarize with Claude
      const summary = await summarizeWithClaude(content, transcript.name)

      // Check if note already exists
      const filename = noteFilename(transcript.createdAt || transcript.modifiedAt, summary.title || label)
      if (existing.has(filename)) {
        console.error(`[meeting] Skipping "${filename}" — already exists`)
        skipped.push({ name: transcript.name, reason: 'note exists', filename })
        continue
      }

      // Fix date if Claude couldn't extract it — use transcript creation date
      if (!summary.date || summary.date.includes('XX') || summary.date === 'unknown') {
        const ts = transcript.createdAt || transcript.modifiedAt
        if (ts) {
          const d = new Date(ts)
          summary.date = `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16).replace(':', ':')}`
        }
      }

      // Generate note
      const note = formatMeetingNote(summary)
      const notePath = join(vaultDir, filename)

      if (dryRun) {
        console.error(`[meeting] DRY RUN — would write: ${filename}`)
        console.error('--- preview ---')
        console.error(note.slice(0, 500))
        console.error('--- end preview ---')
      } else {
        await writeFile(notePath, note, 'utf-8')
        console.error(`[meeting] Wrote: ${notePath}`)
      }

      processed.push({
        transcript: transcript.name,
        noteFile: filename,
        title: summary.title,
        date: summary.date,
        attendees: summary.attendees?.length ?? 0,
        actionItems: summary.actionItems?.length ?? 0,
        dryRun,
      })
    } catch (err) {
      console.error(`[meeting] Error processing "${label}":`, err.message)
      errors.push(`${label}: ${err.message}`)
    }
  }

  return { processed, skipped, errors }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2)
  const { mode, query, lookbackHours } = parseArgs()
  const dryRun = args.includes('--dry-run')
  const listOnly = args.includes('--list')

  // Load config (optional — falls back to defaults if missing)
  try {
    CONFIG = await loadConfig('meetings')
    console.error(`[meeting] Config loaded (${Object.keys(CONFIG.project_tags || {}).length} project tags, ${(CONFIG.known_customers || []).length} known customers)`)
  } catch {
    console.error('[meeting] No meeting-summary.json config found — using defaults')
  }

  // Validate env
  if (!process.env.AZURE_TENANT_ID || !process.env.AZURE_CLIENT_ID) {
    console.log(JSON.stringify(envelope(TOOL, mode, null, [
      'AZURE_TENANT_ID and AZURE_CLIENT_ID must be set in .env'
    ])))
    process.exit(1)
  }

  // Authenticate
  let token
  try {
    token = await getGraphToken()
  } catch (err) {
    console.log(JSON.stringify(envelope(TOOL, mode, null, [
      `Authentication failed: ${err.message}`
    ])))
    process.exit(1)
  }

  // Build search query — .vtt transcripts only
  // (Copilot .docx transcripts are the same content in binary format — skip them)
  let searchQueries
  if (mode === 'search' && query) {
    searchQueries = [`filetype:vtt ${query}`]
  } else {
    searchQueries = ['filetype:vtt']
  }

  console.error(`[meeting] Mode: ${listOnly ? 'list' : mode}${dryRun ? ' (dry-run)' : ''}, queries: ${searchQueries.length}`)
  console.error(`[meeting] Output: ${getVaultMeetings()}`)

  // Collect transcripts from all queries, dedup by driveItemId
  let allTranscripts = []
  const seen = new Set()
  for (const q of searchQueries) {
    console.error(`[meeting] Searching: "${q}"`)
    const found = await findTranscripts(token, q)
    for (const t of found) {
      if (!seen.has(t.driveItemId)) {
        seen.add(t.driveItemId)
        allTranscripts.push(t)
      }
    }
  }
  console.error(`[meeting] Total unique transcripts: ${allTranscripts.length}`)

  // ── Email recaps ──────────────────────────────────────────────────────────
  const recapKeywords = CONFIG.recap_keywords || []
  let recapEmails = []
  if (recapKeywords.length > 0) {
    try {
      const recapLookback = CONFIG.recap_lookback_hours || lookbackHours || 48
      recapEmails = await findMeetingRecapEmails(token, recapKeywords, recapLookback)
      console.error(`[meeting] Found ${recapEmails.length} recap emails`)
    } catch (err) {
      console.error(`[meeting] Recap email search failed: ${err.message}`)
    }
  }

  // Run
  if (listOnly) {
    const result = await runList(token, allTranscripts, recapEmails)
    console.log(JSON.stringify(envelope(TOOL, 'list', result, [])))
  } else {
    const existing = await getExistingNotes()
    const transcriptResult = await runProcess(token, allTranscripts, { dryRun, existing })
    const emailResult = recapEmails.length > 0
      ? await processRecapEmails(token, recapEmails, existing, { dryRun })
      : { processed: [], skipped: [], errors: [] }

    // Merge results from both sources
    const result = {
      processed: [...transcriptResult.processed, ...emailResult.processed],
      skipped: [...transcriptResult.skipped, ...emailResult.skipped],
    }
    const errors = [...(transcriptResult.errors || []), ...emailResult.errors]
    console.log(JSON.stringify(envelope(TOOL, mode, result, errors)))
  }
}

main().catch(err => {
  console.error('[meeting] Fatal:', err)
  console.log(JSON.stringify(envelope(TOOL, 'unknown', null, [err.message])))
  process.exit(1)
})
