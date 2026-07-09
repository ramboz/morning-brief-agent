#!/usr/bin/env node

/**
 * list-open-prs.js — "Your open authored PRs, and which ones have stalled."
 *
 * Gathers the user's own open, authored, non-merged PRs from both GitHub
 * surfaces (github.com + corporate), then classifies each by staleness via
 * lib/github/open-prs.js's extractOpenPrs. Each surface runs independently
 * and fault-tolerantly: one failing surface (missing token, VPN/connector
 * down) never crashes the other or the script (AC5).
 *
 * Read-only throughout: no PR is merged, closed, commented on, or modified.
 *
 * Modes:
 *   --brief    Fetch + classify across enabled surfaces (default; no lookback
 *              bound — open PRs are queried regardless of last-activity age)
 *   --search   Out of scope for slice 009-01 (returns a not-implemented note)
 *
 * Standalone: node scripts/list-open-prs.js --brief
 * Reference:  docs/specs/009-open-work-radar/slice-01-github-open-pr-staleness.md
 */

import dotenv from 'dotenv'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs, loadConfig, envelope } from './lib/config.js'
import { DEFAULT_CONFIG, runOpenPrs } from './lib/github.js'
import { extractOpenPrs, DEFAULT_STALE_DAYS, DEFAULT_VERY_STALE_DAYS } from './lib/github/open-prs.js'

dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), '.env') })

const TOOL = 'github_open_prs'

/**
 * Gather one surface's open authored PRs, tolerating any failure.
 * @param {object} surface - { label, baseUrl, token, config, tokenEnv, baseUrlEnv }
 * @param {string[]} errors - Shared errors array (mutated on failure)
 * @returns {Promise<{ instance: string, prs: object[] }|null>}
 */
async function gatherSurface(surface, errors) {
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
    // Surface any per-org partial failures (some orgs failed, others succeeded).
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
async function loadSection(key, altKeys = []) {
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
 * Load staleness thresholds from config/main.json's `open_work.pr` block,
 * tolerating a missing/invalid config file with the spec defaults (3/7).
 * @returns {Promise<{ staleDays: number, veryStaleDays: number }>}
 */
async function loadThresholds() {
  try {
    const main = await loadConfig('main')
    const pr = main.open_work?.pr ?? {}
    return {
      staleDays: pr.stale_days ?? DEFAULT_STALE_DAYS,
      veryStaleDays: pr.very_stale_days ?? DEFAULT_VERY_STALE_DAYS
    }
  } catch {
    console.error(`[${TOOL}] main config not found, using default staleness thresholds (${DEFAULT_STALE_DAYS}/${DEFAULT_VERY_STALE_DAYS})`)
    return { staleDays: DEFAULT_STALE_DAYS, veryStaleDays: DEFAULT_VERY_STALE_DAYS }
  }
}

async function main() {
  const { mode } = parseArgs()

  if (mode === 'search') {
    console.log(JSON.stringify(envelope(TOOL, 'search', { openPRs: [] }, [
      'search mode not implemented for slice 009-01 — use --brief'
    ])))
    return
  }

  const errors = []
  const thresholds = await loadThresholds()

  const comConfig = await loadSection('github_com', ['github.com'])
  const corpConfig = await loadSection('github_corp', ['corporate'])

  const surfaces = []

  // github.com — run only when enabled
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

  // corporate GitHub — run only when enabled
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

  // Gather all enabled surfaces independently; failures are captured, not thrown (AC5).
  const gathered = await Promise.all(
    surfaces.map(s => gatherSurface(s, errors))
  )

  const instances = gathered.filter(Boolean)
  const openPRs = extractOpenPrs(instances, { now: new Date(), thresholds })

  console.log(JSON.stringify(envelope(TOOL, 'brief', { openPRs }, errors)))
}

main().catch(err => {
  console.error(`[${TOOL}]`, err.message)
  console.log(JSON.stringify(envelope(TOOL, 'brief', { openPRs: [] }, [err.message])))
})
