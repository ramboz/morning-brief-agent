#!/usr/bin/env node

/**
 * fetch-ai-radar.js — RSS feeds + GitHub trending → Claude triage → JSON
 *
 * Fetches curated AI/agent content from RSS, Atom, GitHub releases, GitHub
 * trending, and HuggingFace papers. Runs a Claude-powered relevance triage
 * pass and outputs structured JSON for the daily note.
 *
 * Modes:
 *   --brief              Nightly fetch + triage (default)
 *
 * Standalone: node scripts/fetch-ai-radar.js --brief
 * Reference:  specs/09-ai-radar.md
 *
 * Dependencies: rss-parser, cheerio, dotenv
 */

import 'dotenv/config'
import { parseArgs, envelope, loadConfig } from './lib/config.js'

const TOOL = 'ai_radar'

async function main() {
  const { mode } = parseArgs()
  const errors = []

  let config
  try {
    config = await loadConfig('morning-ai-radar', 'ai-radar-sources.json')
  } catch (err) {
    console.log(JSON.stringify(envelope(TOOL, mode, null, [err.message])))
    process.exit(0)
  }

  if (!config.enabled) {
    console.log(JSON.stringify(envelope(TOOL, mode, null)))
    process.exit(0)
  }

  // TODO: Implement in Phase 7
  // 1. Fetch all enabled sources in parallel (Promise.allSettled)
  //    - RSS/Atom via rss-parser
  //    - GitHub releases via API
  //    - GitHub trending via cheerio HTML scraping
  //    - HuggingFace papers via API
  // 2. Dedup against logs/ai-radar-seen.json
  // 3. Batch triage via Claude API (classify: today_signal / skills_tutorials / strategic_radar / skip)
  // 4. Cap each layer at max_items_per_layer
  // 5. Update dedup cache
  // 6. Output structured JSON
  //
  // See specs/09-ai-radar.md for full implementation details

  console.log(JSON.stringify(envelope(TOOL, mode, null, ['Not yet implemented — Phase 7'])))
}

main().catch(err => {
  console.error(`[${TOOL}]`, err.message)
  console.log(JSON.stringify(envelope(TOOL, 'brief', null, [err.message])))
})
