#!/usr/bin/env node

/**
 * fetch-github-com.js — GitHub.com API → JSON (fallback if connector unavailable)
 *
 * Uses native fetch via shared lib/github.js helpers — no @octokit/rest dependency.
 *
 * Modes:
 *   --brief                              Lookback scan: notifications, PR review requests
 *   --search "query"                     Deep Dive: search PRs/issues by keyword
 *   --context <owner> <repo> <type> <n>  Fetch full context for a PR or issue (type: pr|issue)
 *
 * Standalone: node scripts/fetch-github-com.js --brief
 * Reference:  specs/08-github.md
 */

import dotenv from 'dotenv'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs, loadConfig, envelope } from './lib/config.js'
import { DEFAULT_CONFIG, runBrief, runSearch, runContext } from './lib/github.js'

dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), '.env') })

const TOOL = 'github_com'
const BASE_URL = 'https://api.github.com'
const INSTANCE = 'github.com'

/**
 * Parse --context args: --context <owner> <repo> <type> <number>
 * @returns {{ isContext: boolean, owner?: string, repo?: string, type?: string, number?: number }}
 */
function parseContextArgs() {
  const args = process.argv.slice(2)
  const idx = args.indexOf('--context')
  if (idx === -1) return { isContext: false }
  return {
    isContext: true,
    owner: args[idx + 1] || null,
    repo: args[idx + 2] || null,
    type: args[idx + 3] || 'pr',
    number: parseInt(args[idx + 4], 10) || null
  }
}

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
    const config = await loadConfig('github')
    instanceConfig = config.github_com ?? config['github.com'] ?? DEFAULT_CONFIG
  } catch {
    console.error(`[${TOOL}] Config not found, using defaults (all notification types enabled, no org filter)`)
  }

  const since = new Date(Date.now() - lookbackHours * 60 * 60 * 1000).toISOString()

  // Check for --context mode first
  const ctx = parseContextArgs()
  if (ctx.isContext) {
    if (!ctx.owner || !ctx.repo || !ctx.number) {
      console.log(JSON.stringify(envelope(TOOL, 'context', null, [
        '--context requires: <owner> <repo> <type> <number>'
      ])))
      return
    }
    try {
      const data = await runContext(BASE_URL, token, ctx.owner, ctx.repo, ctx.type, ctx.number, INSTANCE, TOOL)
      console.log(JSON.stringify(envelope(TOOL, 'context', data)))
    } catch (err) {
      console.error(`[${TOOL}]`, err.message)
      console.log(JSON.stringify(envelope(TOOL, 'context', null, [err.message])))
    }
    return
  }

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
