/**
 * Config loader utility for helper scripts.
 * Reads JSON config files from the project-level config/ directory.
 */

import { readFile, stat } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CONFIG_DIR = join(__dirname, '..', '..', 'config')

/**
 * Load a JSON config file from the project config/ directory.
 * @param {string} toolName - e.g. 'jira', 'slack', 'confluence', 'github', 'outlook', 'meetings', 'ai-radar', 'main'
 * @returns {Promise<object>} Parsed config object
 * @throws {Error} If config file is missing or invalid
 */
export async function loadConfig(toolName) {
  const configPath = join(CONFIG_DIR, `${toolName}.json`)

  try {
    const raw = await readFile(configPath, 'utf-8')
    return JSON.parse(raw)
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error(`Config missing: ${configPath} — copy ${toolName}.example.json and fill in your values`)
    }
    throw new Error(`Config invalid: ${configPath} — ${err.message}`)
  }
}

/**
 * Parse CLI args for mode and search query.
 * @returns {{ mode: 'brief' | 'search', query: string | null, lookbackHours: number }}
 */
export function parseArgs() {
  const args = process.argv.slice(2)
  const searchIdx = args.indexOf('--search')
  const lookbackIdx = args.indexOf('--lookback')

  const mode = searchIdx !== -1 ? 'search' : 'brief'
  const query = searchIdx !== -1 ? args[searchIdx + 1] || null : null
  const lookbackHours = lookbackIdx !== -1
    ? parseInt(args[lookbackIdx + 1], 10) || 24
    : parseInt(process.env.LOOKBACK_HOURS, 10) || 24

  return { mode, query, lookbackHours }
}

/**
 * Create the standard output envelope.
 * @param {string} tool - Tool name (e.g. 'jira')
 * @param {string} mode - 'brief' or 'search'
 * @param {object|null} data - Result data
 * @param {string[]} errors - Any errors encountered
 * @returns {object} Standard envelope
 */
export function envelope(tool, mode, data, errors = []) {
  return {
    ok: errors.length === 0,
    tool,
    mode,
    timestamp: new Date().toISOString(),
    data,
    errors
  }
}

/**
 * Retry an async function once on transient failure (network errors, 502/503/429).
 * @param {() => Promise<T>} fn - Async function to execute
 * @param {{ retries?: number, delayMs?: number, label?: string }} [opts]
 * @returns {Promise<T>}
 * @template T
 */
export async function withRetry(fn, { retries = 1, delayMs = 2000, label = '' } = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn()
    } catch (err) {
      const status = err.status || 0
      const isTransient = !status || status === 429 || status === 502 || status === 503
      if (attempt < retries && isTransient) {
        const wait = status === 429 ? delayMs * 2 : delayMs
        console.error(`[retry] ${label || 'request'} failed (${err.message}), retrying in ${wait}ms...`)
        await new Promise(r => setTimeout(r, wait))
        continue
      }
      throw err
    }
  }
}

/**
 * Check if a config file is stale (older than maxDays).
 * @param {string} skillName - e.g. 'morning-slack'
 * @param {string} configFile - e.g. 'slack-sections.json'
 * @param {number} [maxDays=30] - Maximum age in days before warning
 * @returns {Promise<{ stale: boolean, ageDays: number }|null>} null if file doesn't exist
 */
export async function checkConfigAge(toolName, maxDays = 30) {
  const configPath = join(CONFIG_DIR, `${toolName}.json`)
  try {
    const s = await stat(configPath)
    const ageDays = Math.floor((Date.now() - s.mtimeMs) / (1000 * 60 * 60 * 24))
    return { stale: ageDays > maxDays, ageDays }
  } catch {
    return null
  }
}

/**
 * Format a timestamp as a human-readable relative time string.
 * @param {string|Date} timestamp - ISO string or Date object
 * @returns {string} e.g. "2h ago", "yesterday", "3d ago"
 */
export function timeAgo(timestamp) {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp)
  const now = Date.now()
  const diffMs = now - date.getTime()
  if (diffMs < 0) return 'just now'

  const minutes = Math.floor(diffMs / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`

  const days = Math.floor(hours / 24)
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days}d ago`

  const weeks = Math.floor(days / 7)
  if (weeks === 1) return '1w ago'
  return `${weeks}w ago`
}
