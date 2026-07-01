#!/usr/bin/env node

/**
 * stage-review-if-enabled.js — Optionally stage a GitHub PENDING review, but
 * only when the repo/instance has opted in (slice 005-03, ADR-0007).
 *
 * The DEFAULT behavior is local review artifacts only (slice 005-02). This
 * script is the opt-in gate: given a PR and the review body the `pr-review`
 * skill produced, it decides — from config — whether to additionally stage a
 * native GitHub PENDING review. When not opted in, it makes NO API call and
 * simply echoes the local artifact path. When opted in, it stages a body-only
 * (never-submitted) pending review. If staging fails for any reason, the local
 * artifact is PRESERVED and surfaced — the review is never lost.
 *
 * Reads a JSON object from stdin:
 *   {
 *     "pr": { "instance": "com|corp|github.com|corporate",
 *             "owner": "octo-org", "repo": "web-frontend",
 *             "number": 482, "url": "https://github.com/.../pull/482" },
 *     "reviewBody": "<review body from the pr-review skill>",
 *     "artifactPath": "output/github-reviews/YYYY-MM-DD-...-482.md"  // from 005-02
 *   }
 *
 * Flags:
 *   --dry-run   Resolve the decision and report WHAT WOULD be staged (owner/
 *               repo/number, body length) without any API call.
 *
 * SAFETY: The only GitHub write ever performed is creating a PENDING review
 * (body-only POST via stagePendingReview). Never submits, approves, requests
 * changes, merges, or pushes.
 *
 * Standalone:
 *   echo '{"pr":{"owner":"o","repo":"r","number":1},"reviewBody":"x","artifactPath":"..."}' \
 *     | node scripts/stage-review-if-enabled.js --dry-run
 * Reference: docs/specs/005-github-pr-review-automation/slice-03-optional-pending-review-staging.md
 */

import dotenv from 'dotenv'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stagePendingReview, resolveInstance } from './lib/github.js'
import { resolveStagingDecision } from './lib/github/pending-review.js'
import { loadConfig, envelope } from './lib/config.js'

dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), '.env') })

const TOOL = 'github_pending_review'
const MODE = 'stage'

/**
 * Read all of stdin as a string.
 * @returns {Promise<string>}
 */
async function readStdin() {
  const chunks = []
  for await (const chunk of process.stdin) {
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf-8')
}

/**
 * Load the github config. A test hook (GITHUB_STAGING_TEST_CONFIG) lets the
 * test suite inject config without a real config.json on disk.
 * @returns {Promise<object>}
 */
async function loadGithubConfig() {
  if (process.env.GITHUB_STAGING_TEST_CONFIG) {
    return JSON.parse(process.env.GITHUB_STAGING_TEST_CONFIG)
  }
  return loadConfig('github')
}

// resolveInstance is imported from lib/github.js — single source of truth for
// the corporate/.com instance contract, shared with stage-github-review.js.

async function main() {
  const dryRun = process.argv.slice(2).includes('--dry-run')

  let input
  try {
    const raw = await readStdin()
    if (!raw.trim()) throw new Error('empty stdin')
    input = JSON.parse(raw)
  } catch (err) {
    console.log(JSON.stringify(envelope(TOOL, MODE, null, [
      `Invalid JSON on stdin: ${err.message}. Expected: {"pr":{"owner","repo","number"},"reviewBody":"...","artifactPath":"..."}`
    ])))
    return
  }

  const { pr, reviewBody, artifactPath } = input
  if (!pr || !pr.owner || !pr.repo || !pr.number) {
    console.log(JSON.stringify(envelope(TOOL, MODE, { artifactPath: artifactPath ?? null }, [
      'Missing required pr fields: owner, repo, number'
    ])))
    return
  }
  if (!reviewBody || !String(reviewBody).trim()) {
    console.log(JSON.stringify(envelope(TOOL, MODE, { artifactPath: artifactPath ?? null }, [
      'Missing "reviewBody" — run the pr-review skill first and pipe its output here'
    ])))
    return
  }

  const { owner, repo, number, url, instance } = pr
  const { isCorp, configKey } = resolveInstance(instance)

  // Resolve the opt-in decision from config.
  let instanceConfig = {}
  try {
    const config = await loadGithubConfig()
    instanceConfig = config?.[configKey] ?? {}
  } catch (err) {
    // Missing/invalid config => not enabled. Local artifact is the fallback.
    console.error(`[${TOOL}] Config unavailable (${err.message}) — defaulting to local artifact only`)
  }

  const decision = resolveStagingDecision({ instanceConfig, owner, repo })

  // --- Dry run: report intent, no API call ---
  if (dryRun) {
    console.error(`[${TOOL}] DRY RUN — decision: stage=${decision.stage} (${decision.reason})`)
    console.log(JSON.stringify(envelope(TOOL, MODE, {
      dryRun: true,
      wouldStage: decision.stage,
      reason: decision.reason,
      instance: isCorp ? 'corporate' : 'github.com',
      owner,
      repo,
      number,
      bodyLength: String(reviewBody).length,
      prUrl: url ?? null,
      artifactPath: artifactPath ?? null
    })))
    return
  }

  // --- Not opted in (the safe default): local artifact only, no API call ---
  if (!decision.stage) {
    console.error(`[${TOOL}] Not staging — ${decision.reason}`)
    console.log(JSON.stringify(envelope(TOOL, MODE, {
      staged: false,
      reason: decision.reason,
      instance: isCorp ? 'corporate' : 'github.com',
      owner,
      repo,
      number,
      prUrl: url ?? null,
      artifactPath: artifactPath ?? null
    })))
    return
  }

  // --- Opted in: attempt to stage a PENDING review ---
  const baseUrl = isCorp ? process.env.GITHUB_CORP_BASE_URL : 'https://api.github.com'
  const token = isCorp ? process.env.GITHUB_CORP_TOKEN : process.env.GITHUB_COM_TOKEN

  if (!token) {
    const varName = isCorp ? 'GITHUB_CORP_TOKEN' : 'GITHUB_COM_TOKEN'
    console.error(`[${TOOL}] ${varName} not set — preserving local artifact`)
    console.log(JSON.stringify(envelope(TOOL, MODE, {
      staged: false,
      owner, repo, number,
      instance: isCorp ? 'corporate' : 'github.com',
      prUrl: url ?? null,
      artifactPath: artifactPath ?? null
    }, [
      `${varName} not set — pending review NOT staged. The local review artifact is preserved: ${artifactPath ?? '(none)'} (check auth / VPN / connector).`
    ])))
    return
  }
  if (isCorp && !baseUrl) {
    console.error(`[${TOOL}] GITHUB_CORP_BASE_URL not set — preserving local artifact`)
    console.log(JSON.stringify(envelope(TOOL, MODE, {
      staged: false,
      owner, repo, number,
      instance: 'corporate',
      prUrl: url ?? null,
      artifactPath: artifactPath ?? null
    }, [
      `GITHUB_CORP_BASE_URL not set — pending review NOT staged. The local review artifact is preserved: ${artifactPath ?? '(none)'} (check auth / VPN / connector).`
    ])))
    return
  }

  try {
    const { reviewId } = await stagePendingReview({
      baseUrl, token, owner, repo, number, body: reviewBody, toolName: TOOL
    })

    const prUrl = url ?? (isCorp
      ? `${process.env.GITHUB_CORP_BASE_URL?.replace('/api/v3', '')}/${owner}/${repo}/pull/${number}`
      : `https://github.com/${owner}/${repo}/pull/${number}`)

    console.error(`[${TOOL}] Staged PENDING review ${reviewId} on ${owner}/${repo}#${number}`)
    console.log(JSON.stringify(envelope(TOOL, MODE, {
      staged: true,
      reviewId,
      owner,
      repo,
      number,
      prUrl,
      instance: isCorp ? 'corporate' : 'github.com',
      // Still reference the local artifact — it remains the editable source of truth.
      artifactPath: artifactPath ?? null
    })))
  } catch (err) {
    // AC3 safe fallback: staging failed. DO NOT crash. Preserve + surface the
    // local artifact and a clear error (auth/VPN/connector wording).
    console.error(`[${TOOL}] Staging failed: ${err.message} — preserving local artifact`)
    console.log(JSON.stringify(envelope(TOOL, MODE, {
      staged: false,
      owner,
      repo,
      number,
      instance: isCorp ? 'corporate' : 'github.com',
      prUrl: url ?? null,
      artifactPath: artifactPath ?? null
    }, [
      `Pending review staging failed (${err.message}). The local review artifact is preserved and remains the fallback: ${artifactPath ?? '(none)'}. Check auth / VPN / GitHub connector, then re-run or open the artifact directly.`
    ])))
  }
}

main().catch(err => {
  console.error(`[${TOOL}]`, err.message)
  console.log(JSON.stringify(envelope(TOOL, MODE, null, [err.message])))
})
