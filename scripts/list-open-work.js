#!/usr/bin/env node

/**
 * list-open-work.js — the single "Open Work" entry point (slice 009-03).
 *
 * Composes the two DONE 009-01/009-02 sources — the user's open authored
 * PRs (both GitHub instances) and assigned in-progress JIRA tickets — into
 * one envelope, then applies the day-aware selection rule from
 * lib/open-work.js: stale-only every day, expanding to the full inventory
 * (fresh included) on Mondays.
 *
 * This script does no new fetching or classification of its own — it reuses
 * runOpenPrs/extractOpenPrs (lib/github.js, lib/github/open-prs.js) and
 * runInProgress/extractInProgress (lib/jira/query.js, lib/jira/staleness.js)
 * verbatim, the same way list-open-prs.js and list-inprogress.js do.
 *
 * KNOWN DUPLICATION (rule-of-three trigger fired — extraction consciously
 * DEFERRED, see slice 009-03 deviation log): the per-source gather glue below
 * (token/config validation, try/catch, error-message shaping) is a THIRD
 * inline copy of the GitHub surface-gather (also in list-open-prs.js and
 * list-review-requests.js) and a 2nd+ copy of the JIRA error mapping (also in
 * list-inprogress.js). Under this project's "extract on the third caller"
 * convention this IS the extraction point; it is deferred here only to avoid
 * modifying the already-DONE 009-01/009-02 sibling runners inside this slice.
 * Tracked in docs/refinement-todo.md with a resolution trigger — do NOT read
 * this as "no extraction needed."
 *
 * Each source is fault-isolated (AC5 of both sibling slices): a GitHub
 * failure never blocks the JIRA side and vice versa; if both fail, the
 * envelope reports isEmpty with both sources' errors.
 *
 * Read-only throughout: no PR or ticket is merged, commented on, closed, or
 * transitioned.
 *
 * Modes:
 *   --brief    Gather + classify both sources, then apply Monday/weekday
 *              selection (default; no lookback bound — mirrors both sources)
 *   --search   Out of scope for slice 009-03 (returns a not-implemented note)
 *
 * Standalone: node scripts/list-open-work.js --brief
 * Reference:  docs/specs/009-open-work-radar/slice-03-monday-full-inventory.md
 */

import dotenv from 'dotenv'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs, loadConfig, envelope } from './lib/config.js'
import { DEFAULT_CONFIG, runOpenPrs } from './lib/github.js'
import { extractOpenPrs, DEFAULT_STALE_DAYS, DEFAULT_VERY_STALE_DAYS } from './lib/github/open-prs.js'
import { runInProgress } from './lib/jira/query.js'
import {
  extractInProgress,
  DEFAULT_STALE_BUSINESS_DAYS,
  DEFAULT_VERY_STALE_BUSINESS_DAYS
} from './lib/jira/staleness.js'
import { selectOpenWork } from './lib/open-work.js'

dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), '.env') })

const TOOL = 'open_work'

/** @type {RegExp} Valid JIRA project key format (mirrors fetch-jira.js / list-inprogress.js) */
const PROJECT_KEY_RE = /^[A-Z][A-Z0-9]+$/

const EMPTY_DATA = { mondayInventory: false, prs: [], tickets: [], suppressedFreshCount: 0, isEmpty: true }

// ---- GitHub: gather open authored PRs (mirrors list-open-prs.js) ----

/**
 * Gather one GitHub surface's open authored PRs, tolerating any failure.
 * @param {object} surface - { label, baseUrl, token, config, tokenEnv, baseUrlEnv }
 * @param {string[]} errors - Shared errors array (mutated on failure)
 * @returns {Promise<{ instance: string, prs: object[] }|null>}
 */
async function gatherPrSurface(surface, errors) {
  const { label, baseUrl, token, config } = surface

  if (!token) {
    errors.push(`${label}: token missing — check auth (${surface.tokenEnv})`)
    return null
  }
  if (!baseUrl) {
    errors.push(`${label}: base URL missing — check ${surface.baseUrlEnv}`)
    return null
  }

  try {
    const result = await runOpenPrs(baseUrl, token, config, label, TOOL)
    if (result.errors?.length) errors.push(...result.errors)
    return result
  } catch (err) {
    if (err.status === 401 || err.status === 403) {
      errors.push(`${label}: auth failed — token invalid or expired`)
    } else if (!err.status) {
      errors.push(`${label}: unreachable — check VPN or connector availability`)
    } else {
      errors.push(`${label}: ${err.message}`)
    }
    console.error(`[${TOOL}]`, `${label} failed:`, err.message)
    return null
  }
}

/**
 * Load a GitHub config section, tolerating a missing/invalid config file.
 * @param {'github_com'|'github_corp'} key
 * @param {string[]} altKeys - Alternate key names to try
 * @returns {Promise<object>}
 */
async function loadGithubSection(key, altKeys = []) {
  try {
    const config = await loadConfig('github')
    for (const k of [key, ...altKeys]) {
      if (config[k]) return config[k]
    }
    return DEFAULT_CONFIG
  } catch {
    console.error(`[${TOOL}] Config not found, using defaults for ${key}`)
    return DEFAULT_CONFIG
  }
}

/**
 * Load PR staleness thresholds from config/main.json's `open_work.pr` block.
 * @returns {Promise<{ staleDays: number, veryStaleDays: number }>}
 */
async function loadPrThresholds() {
  try {
    const main = await loadConfig('main')
    const pr = main.open_work?.pr ?? {}
    return {
      staleDays: pr.stale_days ?? DEFAULT_STALE_DAYS,
      veryStaleDays: pr.very_stale_days ?? DEFAULT_VERY_STALE_DAYS
    }
  } catch {
    console.error(`[${TOOL}] main config not found, using default PR staleness thresholds (${DEFAULT_STALE_DAYS}/${DEFAULT_VERY_STALE_DAYS})`)
    return { staleDays: DEFAULT_STALE_DAYS, veryStaleDays: DEFAULT_VERY_STALE_DAYS }
  }
}

/**
 * Gather + classify the user's open authored PRs across both GitHub
 * surfaces. Never throws — per-surface failures are captured in `errors`.
 * @param {string[]} errors - Shared errors array (mutated on failure)
 * @returns {Promise<object[]>} extractOpenPrs() output
 */
async function gatherOpenPrs(errors) {
  const thresholds = await loadPrThresholds()
  const comConfig = await loadGithubSection('github_com', ['github.com'])
  const corpConfig = await loadGithubSection('github_corp', ['corporate'])

  const surfaces = []
  if (comConfig.enabled !== false) {
    surfaces.push({
      label: 'github.com',
      baseUrl: 'https://api.github.com',
      token: process.env.GITHUB_COM_TOKEN,
      tokenEnv: 'GITHUB_COM_TOKEN',
      baseUrlEnv: null,
      config: comConfig
    })
  }
  if (corpConfig.enabled !== false) {
    surfaces.push({
      label: 'corporate',
      baseUrl: process.env.GITHUB_CORP_BASE_URL,
      token: process.env.GITHUB_CORP_TOKEN,
      tokenEnv: 'GITHUB_CORP_TOKEN',
      baseUrlEnv: 'GITHUB_CORP_BASE_URL',
      config: corpConfig
    })
  }

  const gathered = await Promise.all(surfaces.map(s => gatherPrSurface(s, errors)))
  const instances = gathered.filter(Boolean)
  return extractOpenPrs(instances, { now: new Date(), thresholds })
}

// ---- JIRA: gather in-progress tickets (mirrors list-inprogress.js) ----

/**
 * Load ticket staleness thresholds from config/main.json's `open_work.jira` block.
 * @returns {Promise<{ staleDays: number, veryStaleDays: number }>}
 */
async function loadJiraThresholds() {
  try {
    const main = await loadConfig('main')
    const jira = main.open_work?.jira ?? {}
    return {
      staleDays: jira.stale_business_days ?? DEFAULT_STALE_BUSINESS_DAYS,
      veryStaleDays: jira.very_stale_business_days ?? DEFAULT_VERY_STALE_BUSINESS_DAYS
    }
  } catch {
    console.error(`[${TOOL}] main config not found, using default JIRA staleness thresholds (${DEFAULT_STALE_BUSINESS_DAYS}/${DEFAULT_VERY_STALE_BUSINESS_DAYS})`)
    return { staleDays: DEFAULT_STALE_BUSINESS_DAYS, veryStaleDays: DEFAULT_VERY_STALE_BUSINESS_DAYS }
  }
}

/**
 * Gather + classify the user's assigned in-progress JIRA tickets. Never
 * throws — every failure mode (missing env, missing config, invalid
 * projects, auth/VPN failure) is captured in `errors` and results in an
 * empty ticket list rather than a thrown error (AC5, mirrors list-inprogress.js).
 * @param {string[]} errors - Shared errors array (mutated on failure)
 * @returns {Promise<object[]>} extractInProgress() output
 */
async function gatherInProgress(errors) {
  const baseUrl = process.env.JIRA_BASE_URL
  const token = process.env.JIRA_API_TOKEN

  if (!baseUrl) {
    errors.push('JIRA_BASE_URL not set')
    return []
  }
  if (!token) {
    errors.push('JIRA_API_TOKEN not set')
    return []
  }

  let config
  try {
    config = await loadConfig('jira')
  } catch {
    errors.push('JIRA config missing or no projects configured — create config/jira.json (copy config/jira.example.json)')
    return []
  }

  if (!Array.isArray(config.projects) || config.projects.length === 0) {
    errors.push('JIRA config missing or no projects configured — add projects to config/jira.json')
    return []
  }

  const validProjects = []
  for (const key of config.projects) {
    if (PROJECT_KEY_RE.test(key)) {
      validProjects.push(key)
    } else {
      console.error(`[${TOOL}] Skipping invalid project key: ${key}`)
    }
  }

  if (validProjects.length === 0) {
    errors.push('No valid JIRA project keys in config')
    return []
  }

  const thresholds = await loadJiraThresholds()

  try {
    const { issues, truncated } = await runInProgress(baseUrl, token, validProjects)
    if (truncated) errors.push('JIRA in-progress query truncated — more tickets exist than were fetched')
    return extractInProgress(issues, { now: new Date(), thresholds })
  } catch (err) {
    let msg
    if (err.status === 401) {
      msg = 'JIRA auth failed — check JIRA_API_TOKEN in .env'
    } else if (!err.status) {
      msg = err.message?.toLowerCase().includes('certificate')
        ? 'JIRA SSL error — certificate could not be verified. Are you on VPN?'
        : 'JIRA unreachable — are you on VPN?'
    } else {
      msg = err.message
    }
    console.error(`[${TOOL}]`, err.message)
    errors.push(msg)
    return []
  }
}

async function main() {
  const { mode } = parseArgs()

  if (mode === 'search') {
    console.log(JSON.stringify(envelope(TOOL, 'search', EMPTY_DATA, [
      'search mode not implemented for slice 009-03 — use --brief'
    ])))
    return
  }

  // Each source is gathered independently; a failure on one side is
  // recorded in its own errors array and never blocks the other (AC5).
  const prErrors = []
  const ticketErrors = []
  const [prs, tickets] = await Promise.all([
    gatherOpenPrs(prErrors),
    gatherInProgress(ticketErrors)
  ])

  const selection = selectOpenWork({ prs, tickets, now: new Date() })

  console.log(JSON.stringify(envelope(TOOL, 'brief', selection, [...prErrors, ...ticketErrors])))
}

main().catch(err => {
  console.error(`[${TOOL}]`, err.message)
  console.log(JSON.stringify(envelope(TOOL, 'brief', EMPTY_DATA, [err.message])))
})
