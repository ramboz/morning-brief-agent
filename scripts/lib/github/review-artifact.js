/**
 * Review-artifact assembly and rendering for GitHub PR reviews (slice 005-02).
 *
 * A Node script cannot run the `pr-review` skill — that is an orchestrator
 * action. So this module provides the two SCRIPTABLE halves of the flow:
 *   1. buildReviewContext — normalize `--context` PR data into a bundle the
 *      pr-review skill consumes, recording any unfetchable pieces in `missing`.
 *   2. renderReviewArtifact / writeReviewArtifact — turn the review body the
 *      skill produced into a findings-lead Markdown artifact and write it to
 *      the repo-local `output/github-reviews/` directory (ADR-0007).
 *
 * Local-first only: this module NEVER calls the GitHub API. Native
 * pending-review staging is a separate, opt-in path (slice 005-03).
 *
 * Purity: every export except writeReviewArtifact is pure (no fetch/fs/env).
 *
 * Used by: scripts/write-review-artifact.js
 * Reference: docs/specs/005-github-pr-review-automation/slice-02-pr-review-artifact.md
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

/** Directory (relative to a base dir) where review artifacts are written. */
export const REVIEWS_SUBDIR = 'output/github-reviews'

/**
 * Normalize raw `--context` PR data into a review bundle for the pr-review skill.
 *
 * Records any context piece that could not be fetched in `missing` (e.g.
 * "diff", "changed files", "review comments") rather than silently dropping it,
 * so the skill and the artifact can note the gap explicitly (DoD).
 *
 * Pure: no fetch, no fs, no process.env.
 *
 * @param {object|null} prData - `data` from a fetch-github-*.js --context ... pr N envelope
 * @returns {{
 *   pr: { instance: string|null, owner: string|null, repo: string|null, number: number|null, title: string|null, author: string|null, url: string|null, state: string|null },
 *   description: string,
 *   changedFiles: { additions: number, deletions: number, changedFiles: number },
 *   diff: string,
 *   reviewComments: object[],
 *   conversationComments: object[],
 *   failedChecks: Array<{ name: string, conclusion: string }>,
 *   linkedIssues: object[],
 *   linkedJiraKeys: string[],
 *   missing: string[]
 * }}
 */
export function buildReviewContext(prData) {
  const d = prData && typeof prData === 'object' ? prData : {}
  const missing = []

  const description = typeof d.body === 'string' ? d.body : ''
  if (!description) missing.push('description')

  const diff = typeof d.diff === 'string' ? d.diff : ''
  if (!diff) missing.push('diff')

  const changedFiles = {
    additions: d.diffStat?.additions ?? 0,
    deletions: d.diffStat?.deletions ?? 0,
    changedFiles: d.diffStat?.changedFiles ?? 0
  }
  // A zero changed-file count with no diff means the file list is unavailable,
  // not that the PR genuinely touches nothing.
  if (changedFiles.changedFiles === 0 && !diff) missing.push('changed files')

  // Comments: an ABSENT field means the fetch could not be performed / failed;
  // an explicit empty array means "fetched, none present" — only the former is
  // recorded as missing.
  const hasReviewComments = Array.isArray(d.reviewComments)
  const reviewComments = hasReviewComments ? d.reviewComments : []
  if (!hasReviewComments) missing.push('review comments')

  const hasConvoComments = Array.isArray(d.conversationComments)
  const conversationComments = hasConvoComments ? d.conversationComments : []
  if (!hasConvoComments) missing.push('conversation comments')

  // Failed checks: an ABSENT ciFailures field means CI status could not be
  // fetched; an explicit empty array means "fetched, none failing".
  const hasCi = Array.isArray(d.ciFailures)
  const failedChecks = hasCi ? d.ciFailures : []
  if (!hasCi) missing.push('failed checks')

  const linkedIssues = Array.isArray(d.linkedIssues) ? d.linkedIssues : []
  const linkedJiraKeys = Array.isArray(d.linkedJiraKeys) ? d.linkedJiraKeys : []

  return {
    pr: {
      instance: d.instance ?? null,
      owner: d.owner ?? null,
      repo: d.repo ?? null,
      number: typeof d.number === 'number' ? d.number : null,
      title: d.title ?? null,
      author: d.author ?? null,
      url: d.url ?? null,
      state: d.state ?? null
    },
    description,
    changedFiles,
    diff,
    reviewComments,
    conversationComments,
    failedChecks,
    linkedIssues,
    linkedJiraKeys,
    missing
  }
}

/**
 * Today's date as YYYY-MM-DD (UTC). Intentionally UTC (not local time): the
 * date is a filename prefix, and a stable timezone keeps artifact names
 * consistent regardless of where the run happens.
 * @returns {string}
 */
function today() {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Replace filesystem-unsafe characters (slashes, whitespace) with a dash.
 * @param {string} value
 * @returns {string}
 */
function sanitize(value) {
  return String(value ?? '')
    .replace(/[/\\\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

/**
 * Compute the repo-relative artifact path for a PR review.
 * `output/github-reviews/YYYY-MM-DD-{instance}-{owner}-{repo}-{number}.md`
 * @param {{ instance?: string, owner: string, repo: string, number: number|string }} pr
 * @param {{ date?: string }} [opts]
 * @returns {string}
 */
export function artifactRelPath(pr, { date } = {}) {
  const d = date || today()
  const instance = sanitize(pr?.instance || 'github.com')
  const owner = sanitize(pr?.owner)
  const repo = sanitize(pr?.repo)
  const number = sanitize(pr?.number)
  return `${REVIEWS_SUBDIR}/${d}-${instance}-${owner}-${repo}-${number}.md`
}

/**
 * Summarize the review context for the artifact's context section.
 * @param {object} context - buildReviewContext output
 * @returns {string}
 */
function renderContextSection(context) {
  const lines = ['## Review context', '']

  const cf = context.changedFiles ?? {}
  if (context.missing?.includes('changed files')) {
    lines.push('- Changed files: unavailable')
  } else {
    lines.push(`- Changed files: ${cf.changedFiles ?? 0} (+${cf.additions ?? 0} / -${cf.deletions ?? 0})`)
  }

  if (context.missing?.includes('failed checks')) {
    lines.push('- Failed checks: unavailable')
  } else if (context.failedChecks && context.failedChecks.length > 0) {
    const names = context.failedChecks.map(c => `\`${c.name}\``).join(', ')
    lines.push(`- Failed checks: ${names}`)
  } else {
    lines.push('- Failed checks: none reported')
  }

  const reviewCount = context.missing?.includes('review comments')
    ? 'unavailable'
    : String(context.reviewComments?.length ?? 0)
  const convoCount = context.missing?.includes('conversation comments')
    ? 'unavailable'
    : String(context.conversationComments?.length ?? 0)
  lines.push(`- Inline review comments: ${reviewCount}`)
  lines.push(`- Conversation comments: ${convoCount}`)

  if (context.linkedIssues && context.linkedIssues.length > 0) {
    const refs = context.linkedIssues
      .map(i => `#${i.number} (${i.title ?? 'untitled'})`)
      .join(', ')
    lines.push(`- Linked issues: ${refs}`)
  }
  if (context.linkedJiraKeys && context.linkedJiraKeys.length > 0) {
    lines.push(`- Linked JIRA: ${context.linkedJiraKeys.join(', ')}`)
  }

  if (context.missing && context.missing.length > 0) {
    lines.push('')
    lines.push(`> **Missing context:** ${context.missing.join(', ')}. ` +
      'This review was produced without the pieces above — treat it as partial ' +
      'and re-run once they can be fetched.')
  }

  return lines.join('\n')
}

/**
 * Render the review artifact Markdown. Findings lead (the pr-review body sits at
 * the top under a `## Review` heading); a header carries repo/#/title/author/
 * URL/instance and a generated timestamp; a `## Review context` section
 * summarizes changed files, failed checks, comment counts, and any missing
 * context with an explicit note.
 *
 * Pure: does not invent findings — `reviewBody` is passed through verbatim.
 *
 * @param {{ pr: object, context: object, reviewBody: string, generatedAt?: Date }} args
 * @returns {string}
 */
export function renderReviewArtifact({ pr, context, reviewBody, generatedAt } = {}) {
  const when = (generatedAt instanceof Date ? generatedAt : new Date()).toISOString()
  const p = pr ?? {}
  const owner = p.owner ?? 'unknown'
  const repo = p.repo ?? 'unknown'
  const number = p.number ?? '?'
  const instance = p.instance ?? 'github.com'
  const title = p.title ?? '(untitled)'
  const author = p.author ?? 'unknown'
  const url = p.url ?? ''

  const header = [
    `# PR Review — ${owner}/${repo} #${number}`,
    '',
    `- **Title:** ${title}`,
    `- **Author:** ${author}`,
    `- **Instance:** ${instance}`,
    url ? `- **URL:** ${url}` : '- **URL:** (unavailable)',
    `- **Generated:** ${when}`,
    ''
  ].join('\n')

  const review = ['## Review', '', (reviewBody ?? '').trim() || '_No review body provided._', ''].join('\n')

  const contextSection = renderContextSection(context ?? {})

  return `${header}\n${review}\n${contextSection}\n`
}

/**
 * Write a rendered review artifact to `{baseDir}/output/github-reviews/...`.
 * The only fs-touching export. Creates the directory tree if needed.
 * No GitHub API calls.
 *
 * @param {{ pr: object, markdown: string, baseDir?: string, date?: string }} args
 * @returns {Promise<string>} Absolute path of the written file
 */
export async function writeReviewArtifact({ pr, markdown, baseDir, date } = {}) {
  const rel = artifactRelPath(pr, { date })
  const abs = resolve(baseDir || process.cwd(), rel)
  await mkdir(dirname(abs), { recursive: true })
  await writeFile(abs, markdown, 'utf-8')
  return abs
}
