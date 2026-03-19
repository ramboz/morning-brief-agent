#!/usr/bin/env node

/**
 * fetch-github-corp.js — Corporate GitHub Enterprise API → JSON
 *
 * Modes:
 *   --brief              Lookback scan: notifications, PR review requests
 *   --search "query"     Deep Dive: search PRs/issues by keyword
 *
 * Standalone: node scripts/fetch-github-corp.js --brief
 * Reference:  specs/08-github.md
 */

import 'dotenv/config'
import { parseArgs, envelope } from './lib/config.js'

const TOOL = 'github_corp'

async function main() {
  const { mode, query, lookbackHours } = parseArgs()
  const errors = []

  const baseUrl = process.env.GITHUB_CORP_BASE_URL
  const token = process.env.GITHUB_CORP_TOKEN

  if (!baseUrl) errors.push('GITHUB_CORP_BASE_URL not set')
  if (!token) errors.push('GITHUB_CORP_TOKEN not set')

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
