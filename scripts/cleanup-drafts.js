#!/usr/bin/env node

/**
 * cleanup-drafts.js — Remove old draft fragments from the vault.
 *
 * Scans {vault}/drafts/ for date-prefixed Markdown files (YYYY-MM-DD-*.md)
 * and deletes any older than the configured retention period.
 *
 * Usage:
 *   node scripts/cleanup-drafts.js                  # default: 3 days
 *   node scripts/cleanup-drafts.js --days 7         # custom retention
 *   node scripts/cleanup-drafts.js --vault /path    # explicit vault path
 *   node scripts/cleanup-drafts.js --dry-run        # show what would be deleted
 *
 * Also cleans up Slack self-DM drafts by tracking staged message timestamps
 * (future enhancement — for now, Slack DMs persist in the DM channel).
 *
 * Standalone: node scripts/cleanup-drafts.js --dry-run
 * Reference:  docs/decisions/adr-0002-draft-generation-and-delivery.md
 */

import dotenv from 'dotenv'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readdir, unlink, stat } from 'node:fs/promises'
import { envelope } from './lib/config.js'

dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), '.env') })

const TOOL = 'draft_cleanup'
const DEFAULT_RETENTION_DAYS = 3

/**
 * Parse CLI args.
 * @returns {{ vaultPath: string|null, retentionDays: number, dryRun: boolean }}
 */
function parseArgs() {
  const args = process.argv.slice(2)

  const daysIdx = args.indexOf('--days')
  const retentionDays = daysIdx !== -1
    ? parseInt(args[daysIdx + 1], 10) || DEFAULT_RETENTION_DAYS
    : DEFAULT_RETENTION_DAYS

  const vaultIdx = args.indexOf('--vault')
  const vaultPath = vaultIdx !== -1 ? args[vaultIdx + 1] || null : process.env.VAULT_PATH || null

  const dryRun = args.includes('--dry-run')

  return { vaultPath, retentionDays, dryRun }
}

/**
 * Extract the date from a draft filename.
 * Expected format: YYYY-MM-DD-tool-target-comment.md
 * @param {string} filename
 * @returns {Date|null}
 */
function parseDateFromFilename(filename) {
  const match = filename.match(/^(\d{4}-\d{2}-\d{2})/)
  if (!match) return null
  const d = new Date(match[1] + 'T00:00:00Z')
  return isNaN(d.getTime()) ? null : d
}

async function main() {
  const { vaultPath, retentionDays, dryRun } = parseArgs()

  if (!vaultPath) {
    console.log(JSON.stringify(envelope(TOOL, 'cleanup', null, [
      'VAULT_PATH not set — set env var or pass --vault /path/to/vault'
    ])))
    return
  }

  const draftsDir = join(vaultPath, 'drafts')

  // Check if drafts directory exists
  let files
  try {
    files = await readdir(draftsDir)
  } catch (err) {
    if (err.code === 'ENOENT') {
      // No drafts directory — nothing to clean
      console.log(JSON.stringify(envelope(TOOL, 'cleanup', {
        scanned: 0,
        deleted: 0,
        kept: 0,
        message: 'No drafts directory found — nothing to clean'
      })))
      return
    }
    throw err
  }

  const mdFiles = files.filter(f => f.endsWith('.md'))
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - retentionDays)
  cutoff.setHours(0, 0, 0, 0)

  const deleted = []
  const kept = []

  for (const file of mdFiles) {
    const fileDate = parseDateFromFilename(file)
    if (!fileDate) {
      kept.push({ file, reason: 'no date in filename' })
      continue
    }

    if (fileDate < cutoff) {
      const filePath = join(draftsDir, file)
      if (dryRun) {
        deleted.push({ file, date: fileDate.toISOString().slice(0, 10), dryRun: true })
        console.error(`[${TOOL}] Would delete: ${file} (${fileDate.toISOString().slice(0, 10)})`)
      } else {
        try {
          await unlink(filePath)
          deleted.push({ file, date: fileDate.toISOString().slice(0, 10) })
          console.error(`[${TOOL}] Deleted: ${file}`)
        } catch (err) {
          console.error(`[${TOOL}] Failed to delete ${file}: ${err.message}`)
          kept.push({ file, reason: `delete failed: ${err.message}` })
        }
      }
    } else {
      kept.push({ file, date: fileDate.toISOString().slice(0, 10), reason: 'within retention' })
    }
  }

  console.log(JSON.stringify(envelope(TOOL, 'cleanup', {
    scanned: mdFiles.length,
    deleted: deleted.length,
    kept: kept.length,
    retentionDays,
    cutoffDate: cutoff.toISOString().slice(0, 10),
    dryRun,
    deletedFiles: deleted,
    keptFiles: kept
  })))
}

main().catch(err => {
  console.error(`[${TOOL}]`, err.message)
  console.log(JSON.stringify(envelope(TOOL, 'cleanup', null, [err.message])))
})
