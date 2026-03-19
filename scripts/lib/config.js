/**
 * Config loader utility for helper scripts.
 * Reads JSON config files from the skills directory.
 */

import { readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * Load a JSON config file from a skill's config directory.
 * @param {string} skillName - e.g. 'morning-jira'
 * @param {string} configFile - e.g. 'jira-filters.json'
 * @returns {Promise<object>} Parsed config object
 * @throws {Error} If config file is missing or invalid
 */
export async function loadConfig(skillName, configFile) {
  const skillsDir = join(__dirname, '..', '..', 'skills')
  const configPath = join(skillsDir, skillName, 'config', configFile)

  try {
    const raw = await readFile(configPath, 'utf-8')
    return JSON.parse(raw)
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error(`Config missing: ${configPath} — copy the .example.json and fill in your values`)
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
