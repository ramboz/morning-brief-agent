#!/usr/bin/env node

/**
 * fetch-github-com.js — GitHub.com API → JSON (fallback if connector unavailable)
 *
 * Uses native fetch via shared lib/github.js helpers — no @octokit/rest dependency.
 *
 * Modes:
 *   --brief              Lookback scan: notifications, PR review requests
 *   --search "query"     Deep Dive: search PRs/issues by keyword
 *
 * Standalone: node scripts/fetch-github-com.js --brief
 * Reference:  specs/08-github.md
 */

import dotenv from 'dotenv'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs, loadConfig, envelope } from './lib/config.js'
import { DEFAULT_CONFIG, runBrief, runSearch } from './lib/github.js'

dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), '.env') })

const TOOL = 'github_com'
const BASE_URL = 'https://api.github.com'
const INSTANCE = 'github.com'

async function main() {
  const { mode, query, lookbackHours } = parseArgs()

  const token = process.env.GITHUB_COM_TOKEN
  if (!token) {
    console.log(JSON.stringify(envelope(TOOL, mode, null, ['GITHUB_COM_TOKEN not set'])))
    return
  }

  // Load config — optional, use defaults if missing
  let instanceConfig = DEFAULT_CONFIG
  try {
    const config = await loadConfig('morning-github', 'github-repos.json')
    instanceConfig = config.github_com ?? config['github.com'] ?? DEFAULT_CONFIG
  } catch {
    console.error(`[${TOOL}] Config not found, using defaults (all notification types enabled, no org filter)`)
  }

  const since = new Date(Date.now() - lookbackHours * 60 * 60 * 1000).toISOString()

  try {
    let data
    if (mode === 'search') {
      if (!query) {
        console.log(JSON.stringify(envelope(TOOL, mode, null, ['--search requires a query string'])))
        return
      }
      data = await runSearch(BASE_URL, token, instanceConfig, query, INSTANCE, TOOL)
    } else {
      data = await runBrief(BASE_URL, token, instanceConfig, since, INSTANCE, TOOL)
    }

    console.log(JSON.stringify(envelope(TOOL, mode, data)))
  } catch (err) {
    if (err.status === 401 || err.status === 403) {
      const msg = err.status === 403 && err.message?.includes('rate')
        ? 'GitHub rate limit exceeded'
        : 'GitHub token invalid — check GITHUB_COM_TOKEN in .env'
      console.log(JSON.stringify(envelope(TOOL, mode, null, [msg])))
      return
    }
    console.error(`[${TOOL}]`, err.message)
    console.log(JSON.stringify(envelope(TOOL, mode, null, [err.message])))
  }
}

main().catch(err => {
  console.error(`[${TOOL}]`, err.message)
  console.log(JSON.stringify(envelope(TOOL, 'brief', null, [err.message])))
})
