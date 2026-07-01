#!/usr/bin/env node

/**
 * write-review-artifact.js — Render + write a local PR review artifact.
 *
 * A Node script cannot run the `pr-review` skill (that is an orchestrator
 * action). This script handles the scriptable tail of the flow: given a PR's
 * context and the review body the skill produced, it renders a findings-lead
 * Markdown artifact and writes it to the repo-local `output/github-reviews/`
 * directory (ADR-0007). Local-first only — NO GitHub API calls in this slice.
 * Native pending-review staging is opt-in and lives in slice 005-03.
 *
 * Reads a JSON payload from stdin:
 *   {
 *     "pr": { "instance": "com|corp|github.com|corporate",
 *             "owner": "octo-org", "repo": "web-frontend", "number": 482,
 *             "title": "...", "author": "...", "url": "..." },
 *     "context": <buildReviewContext output OR raw --context PR data>,
 *     "reviewBody": "<markdown from the pr-review skill>"
 *   }
 *
 * `context` may be either a pre-built bundle (has a `missing` array) or the raw
 * `data` object from a fetch-github-*.js --context envelope — in the latter case
 * buildReviewContext is applied here.
 *
 * Emits ONE JSON envelope to stdout; logs/errors to stderr. Fault-tolerant:
 * bad/empty stdin -> ok:false envelope, never crashes.
 *
 * Standalone:
 *   echo '{"pr":{"owner":"o","repo":"r","number":1},"context":{},"reviewBody":"x"}' \
 *     | node scripts/write-review-artifact.js
 * Reference: docs/specs/005-github-pr-review-automation/slice-02-pr-review-artifact.md
 */

import { envelope } from './lib/config.js'
import {
  buildReviewContext,
  renderReviewArtifact,
  writeReviewArtifact
} from './lib/github/review-artifact.js'

const TOOL = 'github_review_artifact'
const MODE = 'write'

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
 * Detect whether a context object is already a built bundle (vs raw --context data).
 * A built bundle carries a `missing` array; raw context carries a `diffStat`.
 * @param {object} context
 * @returns {boolean}
 */
function looksBuilt(context) {
  return !!context && typeof context === 'object' && Array.isArray(context.missing)
}

async function main() {
  let input
  try {
    const raw = await readStdin()
    if (!raw.trim()) throw new Error('empty stdin')
    input = JSON.parse(raw)
  } catch (err) {
    console.log(JSON.stringify(envelope(TOOL, MODE, null, [
      `Invalid JSON on stdin: ${err.message}. Expected: {"pr":{"owner","repo","number"},"context":{...},"reviewBody":"..."}`
    ])))
    return
  }

  const { pr, context, reviewBody } = input

  if (!pr || !pr.owner || !pr.repo || !pr.number) {
    console.log(JSON.stringify(envelope(TOOL, MODE, null, [
      'Missing required pr fields: owner, repo, number'
    ])))
    return
  }
  // Normalize number: stdin may carry it as a string ("482"). Coerce so the
  // built bundle's typeof-number check keeps it rather than nulling it out.
  const prNumber = Number(pr.number)
  if (Number.isFinite(prNumber)) pr.number = prNumber
  if (!reviewBody || !String(reviewBody).trim()) {
    console.log(JSON.stringify(envelope(TOOL, MODE, null, [
      'Missing "reviewBody" — run the pr-review skill first and pipe its output here'
    ])))
    return
  }

  try {
    // Accept a pre-built bundle or raw --context data.
    const bundle = looksBuilt(context)
      ? context
      : buildReviewContext({
          // Prefer explicit pr fields; fall back to whatever the raw context has.
          instance: pr.instance,
          owner: pr.owner,
          repo: pr.repo,
          number: pr.number,
          title: pr.title,
          author: pr.author,
          url: pr.url,
          ...(context && typeof context === 'object' ? context : {})
        })

    // Merge the caller's pr identity over the bundle's (caller wins for identity).
    const prIdentity = {
      instance: pr.instance ?? bundle.pr?.instance ?? 'github.com',
      owner: pr.owner ?? bundle.pr?.owner,
      repo: pr.repo ?? bundle.pr?.repo,
      number: pr.number ?? bundle.pr?.number,
      title: pr.title ?? bundle.pr?.title,
      author: pr.author ?? bundle.pr?.author,
      url: pr.url ?? bundle.pr?.url,
      state: bundle.pr?.state ?? null
    }

    const markdown = renderReviewArtifact({
      pr: prIdentity,
      context: bundle,
      reviewBody
    })

    const path = await writeReviewArtifact({ pr: prIdentity, markdown })

    console.error(`[${TOOL}] Wrote review artifact: ${path}`)
    console.log(JSON.stringify(envelope(TOOL, MODE, {
      path,
      pr: prIdentity,
      missing: bundle.missing ?? []
    })))
  } catch (err) {
    console.error(`[${TOOL}]`, err.message)
    console.log(JSON.stringify(envelope(TOOL, MODE, null, [err.message])))
  }
}

main().catch(err => {
  console.error(`[${TOOL}]`, err.message)
  console.log(JSON.stringify(envelope(TOOL, MODE, null, [err.message])))
})
