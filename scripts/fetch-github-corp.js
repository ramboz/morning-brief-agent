#!/usr/bin/env node

/**
 * fetch-github-corp.js — Corporate GitHub Enterprise API → JSON
 *
 * Uses native fetch via shared lib/github.js helpers — no @octokit/rest dependency.
 *
 * Modes:
 *   --brief                              Lookback scan: notifications, PR review requests
 *   --search "query"                     Deep Dive: search PRs/issues by keyword
 *   --context <owner> <repo> <type> <n>  Fetch full context for a PR or issue (type: pr|issue)
 *
 * Standalone: node scripts/fetch-github-corp.js --brief
 * Reference:  specs/08-github.md
 */

import dotenv from 'dotenv'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs, loadConfig, envelope } from './lib/config.js'
import { DEFAULT_CONFIG, runBrief, runSearch, runContext } from './lib/github.js'

dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), '.env') })

const TOOL = 'github_corp'
const INSTANCE = 'corporate'

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

  const baseUrl = process.env.GITHUB_CORP_BASE_URL
  const token = process.env.GITHUB_CORP_TOKEN

  if (!baseUrl) {
    console.log(JSON.stringify(envelope(TOOL, mode, null, ['Corporate GitHub base URL not configured — set GITHUB_CORP_BASE_URL in .env'])))
    return
  }
  if (!token) {
    console.log(JSON.stringify(envelope(TOOL, mode, null, ['GitHub token missing/invalid — check GITHUB_CORP_TOKEN in .env'])))
    return
  }

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
      const data = await runContext(baseUrl, token, ctx.owner, ctx.repo, ctx.type, ctx.number, INSTANCE, TOOL)
      console.log(JSON.stringify(envelope(TOOL, 'context', data)))
    } catch (err) {
      console.error(`[${TOOL}]`, err.message)
      if (!err.status) {
        console.log(JSON.stringify(envelope(TOOL, 'context', null, ['Corporate GitHub unreachable — check VPN?'])))
      } else {
        console.log(JSON.stringify(envelope(TOOL, 'context', null, [err.message])))
      }
    }
    return
  }

  // Load config — optional, use defaults if missing
  let instanceConfig = DEFAULT_CONFIG
  try {
    const config = await loadConfig('morning-github', 'github-repos.json')
    instanceConfig = config.corporate ?? config.github_corp ?? DEFAULT_CONFIG
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
      data = await runSearch(baseUrl, token, instanceConfig, query, INSTANCE, TOOL)
    } else {
      data = await runBrief(baseUrl, token, instanceConfig, since, INSTANCE, TOOL)
    }

    console.log(JSON.stringify(envelope(TOOL, mode, data)))
  } catch (err) {
    if (err.status === 401 || err.status === 403) {
      const msg = err.status === 403 && err.message?.includes('rate')
        ? 'GitHub rate limit exceeded'
        : 'GitHub token missing/invalid — check GITHUB_CORP_TOKEN in .env'
      console.log(JSON.stringify(envelope(TOOL, mode, null, [msg])))
      return
    }
    if (!err.status) {
      console.log(JSON.stringify(envelope(TOOL, mode, null, ['Corporate GitHub unreachable — check VPN?'])))
      return
    }
    console.error(`[${TOOL}]`, err.message)
    console.log(JSON.stringify(envelope(TOOL, mode, null, [err.message])))
  }
}

main().catch(err => {
  console.error(`[${TOOL}]`, err.message)
  if (!err.status) {
    console.log(JSON.stringify(envelope(TOOL, 'brief', null, ['Corporate GitHub unreachable — check VPN?'])))
  } else {
    console.log(JSON.stringify(envelope(TOOL, 'brief', null, [err.message])))
  }
})
