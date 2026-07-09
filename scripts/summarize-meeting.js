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
import { findMeetingRecapEmails, fetchEmailBody } from './lib/meetings/recapEmail.js'
import { buildArtifactInventory } from './lib/meetings/inventory.js'
import { selectSummarizableMeetings } from './lib/meetings/summarizable.js'

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

// ── Calendar (invitation scope, ADR-0008) ───────────────────────────────────

/**
 * Fetch yesterday's non-cancelled online meetings, with responseStatus, for
 * ADR-0008 invitation-scope filtering. Mirrors fetch-outlook.js's
 * yesterdayOnlineMeetingEvents pattern so both scripts derive the same
 * scope from the same raw shape (client-side filter, no server-side
 * $filter on isOnlineMeeting/isCancelled — Graph calendarView doesn't
 * support filtering on those fields).
 * @param {string} token
 * @returns {Promise<object[]>} Raw Graph calendar event objects
 */
async function fetchYesterdayOnlineMeetingEvents(token) {
  const yDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const yStart = yDate + 'T00:00:00Z'
  const yEnd = yDate + 'T23:59:59Z'
  const select = 'id,subject,start,end,isOnlineMeeting,onlineMeetingUrl,organizer,location,isAllDay,isCancelled,responseStatus'
  const url = `${GRAPH}/me/calendarView?startDateTime=${yStart}&endDateTime=${yEnd}&$select=${select}&$top=30&$orderby=start/dateTime`
  const result = await graphFetch(token, url)
  return (result.value ?? []).filter(e => e.isOnlineMeeting && !e.isCancelled)
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
// findMeetingRecapEmails / fetchEmailBody now live in lib/meetings/recapEmail.js
// (extracted in slice 006-01 so fetch-outlook.js can share the same discovery
// logic without duplicating it).

/**
 * Process recap emails: fetch body, summarize, write notes.
 * Used by --search mode only (--brief mode uses processSummarizableMeetings,
 * which is scoped to the calendar-derived artifact inventory per ADR-0008).
 * --search mode keeps this pre-existing, calendar-agnostic path unchanged.
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
 * Used by --search mode only (--brief mode uses processSummarizableMeetings,
 * which is scoped to the calendar-derived artifact inventory per ADR-0008).
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

/**
 * Process the calendar-scoped, typed summarizable meetings (transcript or
 * recap-email artifacts) produced by selectSummarizableMeetings(): download
 * content, summarize, write notes. Dedup/filename derivation uses the
 * calendar-sourced meeting title+date (deterministic), not the LLM's own
 * re-extracted summary.title/summary.date, since the LLM can phrase the
 * same meeting's title slightly differently across runs (slice 006-02 AC2).
 * @param {string} token
 * @param {object[]} entries - selectSummarizableMeetings() output
 * @param {object} options
 * @returns {Promise<{processed: object[], skipped: object[], errors: string[]}>}
 */
async function processSummarizableMeetings(token, entries, { dryRun = false, existing = null } = {}) {
  const errors = []
  if (!existing) existing = await getExistingNotes()
  const vaultDir = getVaultMeetings()

  console.error(`[meeting] Processing ${entries.length} summarizable meeting(s)`)

  // Ensure output directory exists
  if (!dryRun && !existsSync(vaultDir)) {
    await mkdir(vaultDir, { recursive: true })
    console.error(`[meeting] Created directory: ${vaultDir}`)
  }

  const processed = []
  const skipped = []

  for (const entry of entries) {
    const label = entry.title
    const isEmail = entry.sourceType === 'recap_email'
    try {
      // Deterministic dedup/filename key from calendar-sourced meeting identity,
      // computed up front — before download/summarize — so a duplicate is
      // detected without spending an LLM call.
      const filename = noteFilename(entry.date, entry.title)
      if (existing.has(filename)) {
        console.error(`[meeting] Skipping "${filename}" — already exists`)
        skipped.push({ name: label, source: entry.sourceType, reason: 'note exists', filename })
        continue
      }

      // Download content
      let content
      if (isEmail) {
        console.error(`[meeting] Fetching email body: "${label}"...`)
        content = await fetchEmailBody(token, entry.artifact.id)
      } else {
        if (!entry.artifact.driveId || !entry.artifact.driveItemId) {
          console.error(`[meeting] Skipping "${label}" — missing drive info`)
          skipped.push({ name: label, source: entry.sourceType, reason: 'missing drive info' })
          continue
        }
        console.error(`[meeting] Downloading "${label}"...`)
        content = await graphDownload(token, entry.artifact.driveId, entry.artifact.driveItemId)
      }

      const minLength = isEmail ? 200 : 100
      if (!content || content.length < minLength) {
        console.error(`[meeting] Skipping "${label}" — content too short (${content?.length ?? 0} chars)`)
        skipped.push({ name: label, source: entry.sourceType, reason: 'content too short' })
        continue
      }

      console.error(`[meeting] Content: ${(content.length / 1024).toFixed(0)}KB — summarizing with Claude...`)

      // Summarize with Claude (the LLM's own title/date extraction still
      // populates the note body/frontmatter — only the filename/dedup key
      // comes from calendar data)
      const summary = await summarizeWithClaude(content, entry.title, isEmail ? 'email' : 'transcript')

      // Fix date if Claude couldn't extract it — fall back to meeting date
      if (!summary.date || summary.date.includes('XX') || summary.date === 'unknown') {
        const d = new Date(entry.date)
        summary.date = `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)}`
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
        source: entry.sourceType,
        meetingId: entry.meetingId,
        title: entry.title,
        noteFile: filename,
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
  } else if (mode === 'search') {
    // --search: ad-hoc keyword search, unchanged by this slice — no
    // calendar/invitation-scope involvement. Processes both matched
    // transcripts and config-keyword-matched recap emails, same as before
    // slice 006-02 (which only rebuilt --brief mode's discovery).
    const existing = await getExistingNotes()
    const transcriptResult = await runProcess(token, allTranscripts, { dryRun, existing })
    const emailResult = recapEmails.length > 0
      ? await processRecapEmails(token, recapEmails, existing, { dryRun })
      : { processed: [], skipped: [], errors: [] }
    const result = {
      processed: [...transcriptResult.processed, ...emailResult.processed],
      skipped: [...transcriptResult.skipped, ...emailResult.skipped],
    }
    const errors = [...(transcriptResult.errors || []), ...emailResult.errors]
    console.log(JSON.stringify(envelope(TOOL, mode, result, errors)))
  } else {
    // --brief: rebuild discovery on top of the ADR-0008-scoped artifact
    // inventory (slice 006-02) instead of the old calendar-agnostic
    // "process every transcript/recap-email hit" pipeline.
    const errors = []

    let calendarEvents = []
    try {
      calendarEvents = await fetchYesterdayOnlineMeetingEvents(token)
      console.error(`[meeting] Found ${calendarEvents.length} in-scope online meeting(s) yesterday`)
    } catch (err) {
      console.error(`[meeting] Calendar fetch failed: ${err.message}`)
      errors.push(`calendar: ${err.message}`)
    }

    let inventory = []
    try {
      inventory = buildArtifactInventory({
        calendarEvents,
        transcripts: allTranscripts,
        recordings: [], // this script doesn't search MP4s — that's fetch-outlook.js's job
        recapEmails,
      })
      console.error(`[meeting] Built meeting artifact inventory: ${inventory.length} meeting(s)`)
    } catch (err) {
      console.error(`[meeting] Meeting artifact inventory failed: ${err.message}`)
      errors.push(`inventory: ${err.message}`)
    }

    const summarizable = selectSummarizableMeetings(inventory)
    console.error(`[meeting] ${summarizable.length} meeting(s) have summarizable text`)

    const existing = await getExistingNotes()
    const { processed, skipped, errors: processErrors } =
      await processSummarizableMeetings(token, summarizable, { dryRun, existing })

    const result = { processed, skipped }
    console.log(JSON.stringify(envelope(TOOL, mode, result, [...errors, ...processErrors])))
  }
}

main().catch(err => {
  console.error('[meeting] Fatal:', err)
  console.log(JSON.stringify(envelope(TOOL, 'unknown', null, [err.message])))
  process.exit(1)
})
