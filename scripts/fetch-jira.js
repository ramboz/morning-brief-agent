#!/usr/bin/env node

/**
 * fetch-jira.js — JIRA DC REST API → JSON
 *
 * Modes:
 *   --brief              Lookback scan: assigned tickets, commented, mentioned
 *   --search "query"     Deep Dive: JQL search by keyword
 *
 * Standalone: node scripts/fetch-jira.js --brief
 * Reference:  specs/06-jira.md
 */

import 'dotenv/config'
import { parseArgs, envelope } from './lib/config.js'

const TOOL = 'jira'

async function main() {
  const { mode, query, lookbackHours } = parseArgs()
  const errors = []

  const baseUrl = process.env.JIRA_BASE_URL
  const user = process.env.JIRA_USER
  const token = process.env.JIRA_API_TOKEN

  if (!baseUrl) errors.push('JIRA_BASE_URL not set')
  if (!user) errors.push('JIRA_USER not set')
  if (!token) errors.push('JIRA_API_TOKEN not set')

  if (errors.length > 0) {
    console.log(JSON.stringify(envelope(TOOL, mode, null, errors)))
    process.exit(0)
  }

  // TODO: Implement in Phase 4
  // - Brief mode: three-pass scan (assigned, commented, mentioned)
  // - Search mode: JQL query with keyword + date range
  // See specs/06-jira.md for API calls and response parsing

  console.log(JSON.stringify(envelope(TOOL, mode, null, ['Not yet implemented — Phase 4'])))
}

main().catch(err => {
  console.error(`[${TOOL}]`, err.message)
  console.log(JSON.stringify(envelope(TOOL, 'brief', null, [err.message])))
})
