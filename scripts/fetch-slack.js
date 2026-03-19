#!/usr/bin/env node

/**
 * fetch-slack.js — Slack API → JSON (fallback if connector unavailable)
 *
 * Modes:
 *   --brief              Lookback scan: mentions, DMs, priority channels
 *   --search "query"     Deep Dive: message search by keyword/channel/sender
 *
 * Standalone: node scripts/fetch-slack.js --brief
 * Reference:  specs/04-slack.md
 */

import 'dotenv/config'
import { parseArgs, envelope } from './lib/config.js'

const TOOL = 'slack'

async function main() {
  const { mode, query, lookbackHours } = parseArgs()

  // TODO: Implement in Phase 2
  // - Brief mode: mentions, DMs, thread updates, priority channels
  // - Search mode: Slack search with query terms, channel/date/sender filters
  // See specs/04-slack.md for API calls and response parsing
  //
  // Note: This script is the fallback path. Prefer the Cowork Slack connector
  // when available (set gather_method: "connector" in config).

  console.log(JSON.stringify(envelope(TOOL, mode, null, ['Not yet implemented — Phase 2'])))
}

main().catch(err => {
  console.error(`[${TOOL}]`, err.message)
  console.log(JSON.stringify(envelope(TOOL, 'brief', null, [err.message])))
})
