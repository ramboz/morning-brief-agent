#!/usr/bin/env node

/**
 * list-review-requests.js — Isolated "PRs you were asked to review" queue.
 *
 * Gathers notifications from both GitHub surfaces (github.com + corporate),
 * then filters to review requests only via lib/github/review-requests.js.
 * Each surface runs independently and fault-tolerantly: one failing surface
 * (missing token, VPN/connector down) never crashes the other or the script.
 *
 * Modes:
 *   --brief    Lookback scan across enabled surfaces (default)
 *   --search   Out of scope for slice 005-01 (returns a not-implemented note)
 *
 * Standalone: node scripts/list-review-requests.js --brief
 * Reference:  docs/specs/005-github-pr-review-automation/slice-01-detect-review-requests.md
 */

import dotenv from 'dotenv'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs, loadConfig, envelope } from './lib/config.js'
import { DEFAULT_CONFIG, runBrief } from './lib/github.js'
import { extractReviewRequests } from './lib/github/review-requests.js'

dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), '.env') })

const TOOL = 'github_review_requests'

/**
 * Gather one surface's notifications, tolerating any failure.
 * @param {object} surface - { label, baseUrl, token, config, missingReasons }
 * @param {string} since - ISO timestamp
 * @param {string[]} errors - Shared errors array (mutated on failure)
 * @returns {Promise<{ instance: string, notifications: object[] }|null>}
 */
async function gatherSurface(surface, since, errors) {
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
    return await runBrief(baseUrl, token, config, since, label, TOOL)
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

async function main() {
  const { mode, lookbackHours } = parseArgs()

  if (mode === 'search') {
    console.log(JSON.stringify(envelope(TOOL, 'search', { reviewRequests: [] }, [
      'search mode not implemented for slice 005-01 — use --brief'
    ])))
    return
  }

  const since = new Date(Date.now() - lookbackHours * 60 * 60 * 1000).toISOString()
  const errors = []

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

  // Gather all enabled surfaces independently; failures are captured, not thrown.
  const gathered = await Promise.all(
    surfaces.map(s => gatherSurface(s, since, errors))
  )

  const instances = gathered.filter(Boolean)
  const reviewRequests = extractReviewRequests(instances)

  console.log(JSON.stringify(envelope(TOOL, 'brief', { reviewRequests }, errors)))
}

main().catch(err => {
  console.error(`[${TOOL}]`, err.message)
  console.log(JSON.stringify(envelope(TOOL, 'brief', { reviewRequests: [] }, [err.message])))
})
