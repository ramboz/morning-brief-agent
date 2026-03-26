#!/usr/bin/env node

/**
 * summarize-meeting.js — Download meeting transcripts and generate Obsidian meeting notes.
 *
 * Finds recent meeting transcripts (.vtt files) in SharePoint via Graph API,
 * downloads their content, sends them to Claude for summarization, and writes
 * Obsidian-formatted meeting notes to the vault's Meetings folder.
 *
 * Modes:
 *   --brief              Process all transcripts from the lookback window
 *   --search "query"     Find and process transcripts matching a search query
 *   --dry-run            Show what would be written without creating files
 *   --list               List available transcripts without processing
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
import { parseArgs, envelope } from './lib/config.js'
import { getGraphToken, graphPost, graphDownload } from './lib/graphAuth.js'

const execFile = promisify(execFileCb)

dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), '..', '.env') })

const TOOL = 'meeting-summary'
const GRAPH = 'https://graph.microsoft.com/v1.0'
const VAULT_MEETINGS = join(
  process.env.VAULT_PATH
    || '/Users/ramboz/Library/CloudStorage/GoogleDrive-ramboz@adobe.com/My Drive/Obsidian/work',
  'Meetings'
)
const MODEL = process.env.MEETING_SUMMARY_MODEL || 'claude-sonnet-4-20250514'
const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude'
const CLAUDE_TIMEOUT_MS = parseInt(process.env.AI_TIMEOUT_MS, 10) || 120_000
const MAX_TRANSCRIPT_CHARS = 200_000

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

// ── Dedup against existing notes ─────────────────────────────────────────────

/**
 * Get list of existing meeting note filenames to avoid duplicates.
 * @returns {Promise<Set<string>>}
 */
async function getExistingNotes() {
  try {
    const files = await readdir(VAULT_MEETINGS)
    return new Set(files.filter(f => f.endsWith('.md')))
  } catch {
    return new Set()
  }
}

/**
 * Derive the expected note filename from a transcript.
 * @param {object} transcript
 * @param {string} meetingTitle - Cleaned title
 * @returns {string} e.g. "2026-03-20 - Sprint Planning.md"
 */
function noteFilename(transcript, meetingTitle) {
  const date = (transcript.createdAt || transcript.modifiedAt || new Date().toISOString()).slice(0, 10)
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
 * Send transcript to Claude and get a structured meeting summary.
 * @param {string} transcriptText - Full .vtt content
 * @param {string} transcriptName - File name for context
 * @returns {Promise<object>} { title, date, attendees, tags, summary, actionItems }
 */
async function summarizeWithClaude(transcriptText, transcriptName) {
  // Truncate very long transcripts
  const text = transcriptText.length > MAX_TRANSCRIPT_CHARS
    ? transcriptText.slice(0, MAX_TRANSCRIPT_CHARS) + '\n\n[... transcript truncated ...]'
    : transcriptText

  const prompt = `You are a meeting notes assistant. Given a meeting transcript, produce a structured summary.

TRANSCRIPT FILE: ${transcriptName}

INSTRUCTIONS:
1. Extract the meeting title from context (clean it up — remove dates, recording suffixes, etc.)
2. Extract the date (from timestamps or filename)
3. List all attendees (full names where possible)
4. Identify 1-3 relevant project tags from the content (short lowercase codes like: aso, cwv, pzn, experimentation, gtm, martech, infrastructure, security, onboarding, ops)
5. Write a concise summary using nested bullet points:
   - Top-level bullets for main topics discussed
   - Sub-bullets for key details, decisions, and context
   - Keep it conversational and concise (not formal/corporate)
   - Capture decisions and important context, skip small talk
6. Extract action items as a checkbox list
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

If the customer/external org is mentioned, set "customer" to the org name (e.g. "SAP", "Lilly").
If no action items are found, return an empty array.
Return ONLY the JSON object, no markdown fencing.

TRANSCRIPT:
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
      '--model', MODEL,
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
 * List available transcripts without processing.
 * @param {string} token
 * @param {object[]} transcripts - Pre-fetched transcripts
 */
async function runList(token, transcripts) {
  const existing = await getExistingNotes()

  console.error(`[meeting] Listing ${transcripts.length} transcripts`)
  for (const t of transcripts) {
    const guessTitle = t.name.replace(/\.vtt$/, '').replace(/-\d{8}_\d{6}-Meeting Recording/, '')
    const fname = noteFilename(t, guessTitle)
    const exists = existing.has(fname) ? ' [EXISTS]' : ''
    console.error(`  ${t.createdAt.slice(0, 10)} | ${t.name} (${(t.size / 1024).toFixed(0)}KB)${exists}`)
  }

  return { transcripts, count: transcripts.length }
}

/**
 * Process transcripts: download, summarize, write notes.
 * @param {string} token
 * @param {object[]} transcripts - Pre-fetched transcripts
 * @param {object} options
 * @returns {Promise<object>}
 */
async function runProcess(token, transcripts, { dryRun = false } = {}) {
  const errors = []
  const existing = await getExistingNotes()

  console.error(`[meeting] Processing ${transcripts.length} transcripts`)

  // Ensure output directory exists
  if (!dryRun && !existsSync(VAULT_MEETINGS)) {
    await mkdir(VAULT_MEETINGS, { recursive: true })
    console.error(`[meeting] Created directory: ${VAULT_MEETINGS}`)
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
      const filename = noteFilename(transcript, summary.title || label)
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
      const notePath = join(VAULT_MEETINGS, filename)

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
  console.error(`[meeting] Output: ${VAULT_MEETINGS}`)

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

  // Run
  if (listOnly) {
    const result = await runList(token, allTranscripts)
    console.log(JSON.stringify(envelope(TOOL, 'list', result, [])))
  } else {
    const result = await runProcess(token, allTranscripts, { dryRun })
    const errors = result.errors
    delete result.errors
    console.log(JSON.stringify(envelope(TOOL, mode, result, errors)))
  }
}

main().catch(err => {
  console.error('[meeting] Fatal:', err)
  console.log(JSON.stringify(envelope(TOOL, 'unknown', null, [err.message])))
  process.exit(1)
})
