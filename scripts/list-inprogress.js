#!/usr/bin/env node

/**
 * list-inprogress.js — "Your in-progress JIRA tickets, and which ones have
 * gone quiet."
 *
 * Gathers the user's assigned, in-progress tickets across configured
 * projects — no lookback bound; `statusCategory = "In Progress"` regardless
 * of last-update age, since staleness is exactly what the brief's -Nh window
 * would filter out (Assumption A2, spec 009) — then classifies each by
 * staleness via lib/jira/staleness.js's extractInProgress. Fault-isolated:
 * any failure (missing config/token, VPN down, auth error) is captured in
 * the envelope's errors[] rather than thrown past main() (AC5).
 *
 * Read-only throughout: no ticket is transitioned, commented on, or
 * otherwise modified.
 *
 * Modes:
 *   --brief    Fetch + classify in-progress tickets across configured
 *              projects (default; no lookback bound)
 *   --search   Out of scope for slice 009-02 (returns a not-implemented note)
 *
 * Standalone: node scripts/list-inprogress.js --brief
 * Reference:  docs/specs/009-open-work-radar/slice-02-jira-inprogress-staleness.md
 */

import dotenv from 'dotenv'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs, loadConfig, envelope } from './lib/config.js'
import { runInProgress } from './lib/jira/query.js'
import {
  extractInProgress,
  DEFAULT_STALE_BUSINESS_DAYS,
  DEFAULT_VERY_STALE_BUSINESS_DAYS
} from './lib/jira/staleness.js'

dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), '.env') })

const TOOL = 'jira_in_progress'

/** @type {RegExp} Valid JIRA project key format (mirrors fetch-jira.js) */
const PROJECT_KEY_RE = /^[A-Z][A-Z0-9]+$/

/**
 * Load staleness thresholds from config/main.json's `open_work.jira` block,
 * tolerating a missing/invalid config file with the spec defaults (3/5).
 * @returns {Promise<{ staleDays: number, veryStaleDays: number }>}
 */
async function loadThresholds() {
  try {
    const main = await loadConfig('main')
    const jira = main.open_work?.jira ?? {}
    return {
      staleDays: jira.stale_business_days ?? DEFAULT_STALE_BUSINESS_DAYS,
      veryStaleDays: jira.very_stale_business_days ?? DEFAULT_VERY_STALE_BUSINESS_DAYS
    }
  } catch {
    console.error(`[${TOOL}] main config not found, using default staleness thresholds (${DEFAULT_STALE_BUSINESS_DAYS}/${DEFAULT_VERY_STALE_BUSINESS_DAYS})`)
    return { staleDays: DEFAULT_STALE_BUSINESS_DAYS, veryStaleDays: DEFAULT_VERY_STALE_BUSINESS_DAYS }
  }
}

async function main() {
  const { mode } = parseArgs()

  if (mode === 'search') {
    console.log(JSON.stringify(envelope(TOOL, 'search', { inProgress: [] }, [
      'search mode not implemented for slice 009-02 — use --brief'
    ])))
    return
  }

  const baseUrl = process.env.JIRA_BASE_URL
  const token = process.env.JIRA_API_TOKEN

  if (!baseUrl) {
    console.log(JSON.stringify(envelope(TOOL, mode, { inProgress: [] }, ['JIRA_BASE_URL not set'])))
    return
  }
  if (!token) {
    console.log(JSON.stringify(envelope(TOOL, mode, { inProgress: [] }, ['JIRA_API_TOKEN not set'])))
    return
  }

  let config
  try {
    config = await loadConfig('jira')
  } catch {
    console.log(JSON.stringify(envelope(TOOL, mode, { inProgress: [] }, [
      'JIRA config missing or no projects configured — create config/jira.json (copy config/jira.example.json)'
    ])))
    return
  }

  if (!Array.isArray(config.projects) || config.projects.length === 0) {
    console.log(JSON.stringify(envelope(TOOL, mode, { inProgress: [] }, [
      'JIRA config missing or no projects configured — add projects to config/jira.json'
    ])))
    return
  }

  // Validate project keys (mirrors fetch-jira.js — never trust config blindly)
  const validProjects = []
  for (const key of config.projects) {
    if (PROJECT_KEY_RE.test(key)) {
      validProjects.push(key)
    } else {
      console.error(`[${TOOL}] Skipping invalid project key: ${key}`)
    }
  }

  if (validProjects.length === 0) {
    console.log(JSON.stringify(envelope(TOOL, mode, { inProgress: [] }, ['No valid JIRA project keys in config'])))
    return
  }

  const thresholds = await loadThresholds()

  try {
    const { issues, truncated } = await runInProgress(baseUrl, token, validProjects)
    const errors = truncated
      ? ['JIRA in-progress query truncated — more tickets exist than were fetched']
      : []

    const inProgress = extractInProgress(issues, { now: new Date(), thresholds })
    console.log(JSON.stringify(envelope(TOOL, mode, { inProgress }, errors)))
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
    console.log(JSON.stringify(envelope(TOOL, mode, { inProgress: [] }, [msg])))
  }
}

main().catch(err => {
  console.error(`[${TOOL}]`, err.message)
  console.log(JSON.stringify(envelope(TOOL, 'brief', { inProgress: [] }, [err.message])))
})
