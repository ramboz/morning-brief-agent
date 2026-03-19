#!/usr/bin/env node

/**
 * fetch-confluence.js — Confluence DC REST API → JSON
 *
 * Modes:
 *   --brief              Lookback scan: recently updated pages in watched spaces
 *   --search "query"     Deep Dive: CQL search by keyword
 *
 * Standalone: node scripts/fetch-confluence.js --brief
 * Reference:  specs/07-confluence.md
 */

import 'dotenv/config'
import { parseArgs, envelope } from './lib/config.js'

const TOOL = 'confluence'

async function main() {
  const { mode, query, lookbackHours } = parseArgs()
  const errors = []

  const baseUrl = process.env.CONFLUENCE_BASE_URL
  const user = process.env.CONFLUENCE_USER
  const token = process.env.CONFLUENCE_API_TOKEN

  if (!baseUrl) errors.push('CONFLUENCE_BASE_URL not set')
  if (!user) errors.push('CONFLUENCE_USER not set')
  if (!token) errors.push('CONFLUENCE_API_TOKEN not set')

  if (errors.length > 0) {
    console.log(JSON.stringify(envelope(TOOL, mode, null, errors)))
    process.exit(0)
  }

  // TODO: Implement in Phase 5
  // - Brief mode: recently updated pages + wiki-state.json diffing
  // - Search mode: CQL query with space/keyword/date filters
  // See specs/07-confluence.md for API calls and response parsing

  console.log(JSON.stringify(envelope(TOOL, mode, null, ['Not yet implemented — Phase 5'])))
}

main().catch(err => {
  console.error(`[${TOOL}]`, err.message)
  console.log(JSON.stringify(envelope(TOOL, 'brief', null, [err.message])))
})
