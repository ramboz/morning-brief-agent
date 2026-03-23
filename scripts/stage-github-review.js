#!/usr/bin/env node

/**
 * stage-github-review.js — Create a pending PR review via the GitHub API.
 *
 * Usage:
 *   echo '{"owner":"adobe","repo":"helix-project","number":482,"body":"Review text..."}' | node scripts/stage-github-review.js
 *   echo '{"owner":"adobe","repo":"helix-project","number":482,"body":"...","instance":"corp"}' | node scripts/stage-github-review.js
 *
 * Reads a JSON object from stdin with:
 *   - owner:     Repo owner (org or user)
 *   - repo:      Repo name
 *   - number:    PR number
 *   - body:      Review body text (markdown)
 *   - instance:  "com" (default) or "corp" — determines which token/base URL to use
 *
 * Creates a pending review (event: "PENDING") — invisible to others until
 * the user clicks "Submit review" in the GitHub UI.
 *
 * SAFETY: Never submits the review. Never approves or requests changes.
 * Only creates a PENDING review with a "Comment" body.
 *
 * Standalone: echo '{"owner":"o","repo":"r","number":1,"body":"test"}' | node scripts/stage-github-review.js
 * Reference:  docs/decisions/ADR-002-draft-generation-and-delivery.md
 */

import dotenv from 'dotenv'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { githubPost } from './lib/github.js'
import { envelope } from './lib/config.js'

dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), '.env') })

const TOOL = 'github_review'

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

async function main() {
  let input
  try {
    const raw = await readStdin()
    input = JSON.parse(raw)
  } catch (err) {
    console.log(JSON.stringify(envelope(TOOL, 'draft', null, [
      `Invalid JSON on stdin: ${err.message}. Expected: {"owner":"...","repo":"...","number":123,"body":"..."}`
    ])))
    return
  }

  const { owner, repo, number, body, instance } = input

  if (!owner || !repo || !number) {
    console.log(JSON.stringify(envelope(TOOL, 'draft', null, [
      'Missing required fields: owner, repo, number'
    ])))
    return
  }
  if (!body) {
    console.log(JSON.stringify(envelope(TOOL, 'draft', null, ['Missing "body" field'])))
    return
  }

  // Determine base URL and token based on instance
  const isCorp = instance === 'corp'
  const baseUrl = isCorp
    ? process.env.GITHUB_CORP_BASE_URL
    : 'https://api.github.com'
  const token = isCorp
    ? process.env.GITHUB_CORP_TOKEN
    : process.env.GITHUB_COM_TOKEN

  if (!token) {
    const varName = isCorp ? 'GITHUB_CORP_TOKEN' : 'GITHUB_COM_TOKEN'
    console.log(JSON.stringify(envelope(TOOL, 'draft', null, [`${varName} not set`])))
    return
  }
  if (isCorp && !baseUrl) {
    console.log(JSON.stringify(envelope(TOOL, 'draft', null, ['GITHUB_CORP_BASE_URL not set'])))
    return
  }

  try {
    console.error(`[${TOOL}] Creating pending review for ${owner}/${repo}#${number}`)

    const { data } = await githubPost(baseUrl, token,
      `/repos/${owner}/${repo}/pulls/${number}/reviews`,
      { body }
    )

    const prUrl = isCorp
      ? `${process.env.GITHUB_CORP_BASE_URL?.replace('/api/v3', '')}/${owner}/${repo}/pull/${number}`
      : `https://github.com/${owner}/${repo}/pull/${number}`

    console.log(JSON.stringify(envelope(TOOL, 'draft', {
      staged: true,
      reviewId: data.id,
      owner,
      repo,
      number,
      prUrl,
      instance: isCorp ? 'corporate' : 'github.com'
    })))
  } catch (err) {
    console.error(`[${TOOL}]`, err.message)
    console.log(JSON.stringify(envelope(TOOL, 'draft', null, [err.message])))
  }
}

main()
