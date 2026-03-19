#!/usr/bin/env node

/**
 * fetch-github-com.js — GitHub.com API → JSON (fallback if connector unavailable)
 *
 * Modes:
 *   --brief              Lookback scan: notifications, PR review requests
 *   --search "query"     Deep Dive: search PRs/issues by keyword
 *
 * Standalone: node scripts/fetch-github-com.js --brief
 * Reference:  specs/08-github.md
 */

import 'dotenv/config'
import { parseArgs, envelope } from './lib/config.js'

const TOOL = 'github_com'

async function main() {
  const { mode, query, lookbackHours } = parseArgs()
  const errors = []

  const token = process.env.GITHUB_COM_TOKEN

  if (!token) errors.push('GITHUB_COM_TOKEN not set')

  if (errors.length > 0) {
    console.log(JSON.stringify(envelope(TOOL, mode, null, errors)))
    process.exit(0)
  }

  // TODO: Implement in Phase 6
  // - Brief mode: notifications + PR enrichment
  // - Search mode: search PRs/issues/commits by keyword, repo, author
  // See specs/08-github.md for API calls and response parsing

  console.log(JSON.stringify(envelope(TOOL, mode, null, ['Not yet implemented — Phase 6'])))
}

main().catch(err => {
  console.error(`[${TOOL}]`, err.message)
  console.log(JSON.stringify(envelope(TOOL, 'brief', null, [err.message])))
})
