#!/usr/bin/env node

/**
 * discard-github-review.js — Delete pending PR reviews created by the morning agent.
 *
 * Usage:
 *   node scripts/discard-github-review.js --pr adobe/spacecat-api-service#2007
 *   node scripts/discard-github-review.js --pr adobe/spacecat-api-service#2007 --instance corp
 *   node scripts/discard-github-review.js --all
 *   node scripts/discard-github-review.js --all --instance corp
 *
 * Modes:
 *   --pr <owner/repo#number>   Discard pending review(s) on a specific PR
 *   --all                      Discard ALL pending reviews staged by the agent (reads last-run.json)
 *   --instance <com|corp>      Which GitHub instance (default: com)
 *   --dry-run                  Show what would be deleted without deleting
 *
 * IMPORTANT: Uses the same GITHUB_COM_TOKEN / GITHUB_CORP_TOKEN that created the reviews.
 * The `gh` CLI uses different OAuth auth and CANNOT see or delete these pending reviews.
 *
 * Standalone: node scripts/discard-github-review.js --pr adobe/repo#123
 * Reference:  docs/decisions/ADR-002-draft-generation-and-delivery.md
 */

import dotenv from 'dotenv'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { githubGet } from './lib/github.js'
import { envelope } from './lib/config.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '.env') })

const TOOL = 'github_review_discard'

/**
 * Resolve base URL and token for the given instance.
 * @param {'com'|'corp'} instance
 * @returns {{ baseUrl: string, token: string }|null}
 */
function resolveAuth(instance) {
  const isCorp = instance === 'corp'
  const baseUrl = isCorp
    ? process.env.GITHUB_CORP_BASE_URL
    : 'https://api.github.com'
  const token = isCorp
    ? process.env.GITHUB_CORP_TOKEN
    : process.env.GITHUB_COM_TOKEN

  if (!token) {
    const varName = isCorp ? 'GITHUB_CORP_TOKEN' : 'GITHUB_COM_TOKEN'
    console.error(`[${TOOL}] ${varName} not set`)
    return null
  }
  if (isCorp && !baseUrl) {
    console.error(`[${TOOL}] GITHUB_CORP_BASE_URL not set`)
    return null
  }

  return { baseUrl, token }
}

/**
 * List pending reviews by the authenticated user on a PR.
 * @param {string} baseUrl
 * @param {string} token
 * @param {string} owner
 * @param {string} repo
 * @param {number} number
 * @returns {Promise<Array<{id: number, body: string}>>}
 */
async function listPendingReviews(baseUrl, token, owner, repo, number) {
  try {
    const { data } = await githubGet(baseUrl, token,
      `/repos/${owner}/${repo}/pulls/${number}/reviews`, { per_page: 100 })
    return (data || [])
      .filter(r => r.state === 'PENDING')
      .map(r => ({ id: r.id, body: (r.body || '').slice(0, 80) }))
  } catch (err) {
    console.error(`[${TOOL}] Failed to list reviews for ${owner}/${repo}#${number}: ${err.message}`)
    return []
  }
}

/**
 * Delete a single pending review.
 * @param {string} baseUrl
 * @param {string} token
 * @param {string} owner
 * @param {string} repo
 * @param {number} prNumber
 * @param {number} reviewId
 * @returns {Promise<boolean>}
 */
async function deleteReview(baseUrl, token, owner, repo, prNumber, reviewId) {
  const url = `${baseUrl}/repos/${owner}/${repo}/pulls/${prNumber}/reviews/${reviewId}`
  try {
    const res = await fetch(url, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      console.error(`[${TOOL}] DELETE failed (${res.status}): ${text.slice(0, 200)}`)
      return false
    }
    return true
  } catch (err) {
    console.error(`[${TOOL}] DELETE error: ${err.message}`)
    return false
  }
}

/**
 * Parse --pr flag: "owner/repo#number"
 * @param {string} prRef
 * @returns {{ owner: string, repo: string, number: number }|null}
 */
function parsePrRef(prRef) {
  const match = prRef.match(/^([^/]+)\/([^#]+)#(\d+)$/)
  if (!match) return null
  return { owner: match[1], repo: match[2], number: parseInt(match[3], 10) }
}

/**
 * Load last-run.json to find recently staged reviews.
 * Checks both ~/.claude/skills/ (runtime) and repo skills/ (fallback).
 * @returns {Promise<Array<{owner: string, repo: string, number: number, instance: string}>>}
 */
async function loadStagedReviews() {
  const homePath = join(process.env.HOME, '.claude', 'skills', 'morning-assistant', 'state', 'last-run.json')
  const repoPath = join(__dirname, '..', 'skills', 'morning-assistant', 'state', 'last-run.json')

  let state = null
  for (const p of [homePath, repoPath]) {
    try {
      const raw = await readFile(p, 'utf-8')
      state = JSON.parse(raw)
      console.error(`[${TOOL}] Loaded state from ${p}`)
      break
    } catch { /* try next */ }
  }

  if (!state) {
    console.error(`[${TOOL}] Could not read last-run.json from either location`)
    return []
  }

  const reviews = state.github_reviews_staged || []
  return reviews.map(r => ({
    owner: r.owner,
    repo: r.repo,
    number: r.number,
    instance: r.instance === 'corporate' ? 'corp' : 'com'
  }))
}

async function main() {
  const args = process.argv.slice(2)
  const prIdx = args.indexOf('--pr')
  const allMode = args.includes('--all')
  const dryRun = args.includes('--dry-run')
  const instanceIdx = args.indexOf('--instance')
  const defaultInstance = instanceIdx !== -1 ? args[instanceIdx + 1] : 'com'

  if (!allMode && prIdx === -1) {
    console.log(JSON.stringify(envelope(TOOL, 'discard', null, [
      'Usage: --pr <owner/repo#number> [--instance com|corp] or --all [--dry-run]'
    ])))
    return
  }

  /** @type {Array<{owner: string, repo: string, number: number, instance: string}>} */
  let targets = []

  if (prIdx !== -1) {
    const ref = parsePrRef(args[prIdx + 1] || '')
    if (!ref) {
      console.log(JSON.stringify(envelope(TOOL, 'discard', null, [
        'Invalid --pr format. Expected: owner/repo#number (e.g. adobe/spacecat-api-service#2007)'
      ])))
      return
    }
    targets.push({ ...ref, instance: defaultInstance })
  }

  if (allMode) {
    const staged = await loadStagedReviews()
    if (staged.length === 0) {
      console.log(JSON.stringify(envelope(TOOL, 'discard', {
        message: 'No staged reviews found in last-run.json',
        deleted: 0
      })))
      return
    }
    targets.push(...staged)
  }

  // Dedup targets
  const seen = new Set()
  targets = targets.filter(t => {
    const key = `${t.instance}:${t.owner}/${t.repo}#${t.number}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  const results = []
  let totalDeleted = 0

  for (const target of targets) {
    const auth = resolveAuth(target.instance)
    if (!auth) {
      results.push({ pr: `${target.owner}/${target.repo}#${target.number}`, instance: target.instance, error: 'auth failed' })
      continue
    }

    const pending = await listPendingReviews(auth.baseUrl, auth.token, target.owner, target.repo, target.number)

    if (pending.length === 0) {
      console.error(`[${TOOL}] No pending reviews on ${target.owner}/${target.repo}#${target.number} (${target.instance})`)
      results.push({ pr: `${target.owner}/${target.repo}#${target.number}`, instance: target.instance, pending: 0, deleted: 0 })
      continue
    }

    for (const review of pending) {
      if (dryRun) {
        console.error(`[${TOOL}] DRY RUN — would delete review ${review.id} on ${target.owner}/${target.repo}#${target.number}: "${review.body}..."`)
        results.push({ pr: `${target.owner}/${target.repo}#${target.number}`, instance: target.instance, reviewId: review.id, action: 'would_delete' })
      } else {
        const ok = await deleteReview(auth.baseUrl, auth.token, target.owner, target.repo, target.number, review.id)
        if (ok) {
          console.error(`[${TOOL}] Deleted review ${review.id} on ${target.owner}/${target.repo}#${target.number}`)
          totalDeleted++
        }
        results.push({
          pr: `${target.owner}/${target.repo}#${target.number}`,
          instance: target.instance,
          reviewId: review.id,
          action: ok ? 'deleted' : 'failed'
        })
      }
    }
  }

  console.log(JSON.stringify(envelope(TOOL, 'discard', {
    targets: targets.length,
    deleted: totalDeleted,
    dryRun,
    results
  })))
}

main()
