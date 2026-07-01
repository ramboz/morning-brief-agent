/**
 * Pure gating logic for opt-in native pending-review staging (slice 005-03).
 *
 * Native GitHub pending-review staging is OFF by default (ADR-0007). The
 * default behavior is local review artifacts only (slice 005-02). This module
 * decides — from config alone — whether a given PR's instance+repo has opted
 * in to native staging. It performs NO network, fs, or process.env access, so
 * it is trivially testable and side-effect free.
 *
 * Config shape (per instance, under `github_com` / `github_corp`):
 *   "pending_review_staging": { "enabled": false, "repos": [] }
 *
 * Rules:
 *   - enabled absent / falsy   -> stage:false (the safe default)
 *   - enabled:true, repos:[]   -> stage:true for ALL detected review-request
 *                                 repos on that instance (documented broad opt-in)
 *   - enabled:true, repos:[..] -> stage:true only if the repo is in the list.
 *                                 Entries match either bare "repo" or "owner/repo".
 *
 * Reference: docs/specs/005-github-pr-review-automation/slice-03-optional-pending-review-staging.md
 */

/**
 * Resolve whether to stage a native pending review for this instance+repo.
 * Pure — no network, no fs, no process.env.
 *
 * @param {{ instanceConfig: object|null|undefined, owner: string, repo: string }} args
 * @returns {{ stage: boolean, reason: string }}
 */
export function resolveStagingDecision({ instanceConfig, owner, repo }) {
  const staging = instanceConfig && typeof instanceConfig === 'object'
    ? instanceConfig.pending_review_staging
    : null

  if (!staging || !staging.enabled) {
    return {
      stage: false,
      reason: 'Native pending-review staging is disabled (opt-in only) — local review artifact is the default.'
    }
  }

  const repos = Array.isArray(staging.repos) ? staging.repos : []

  if (repos.length === 0) {
    return {
      stage: true,
      reason: 'Staging enabled with an empty allowlist — staging for all detected review-request repos on this instance.'
    }
  }

  const bare = String(repo ?? '')
  const qualified = `${owner ?? ''}/${repo ?? ''}`
  const allowed = repos.some(entry => entry === bare || entry === qualified)

  if (allowed) {
    return { stage: true, reason: `Staging enabled and ${qualified} is in the allowlist.` }
  }

  return {
    stage: false,
    reason: `Staging enabled but ${qualified} is not in the allowlist — falling back to local review artifact.`
  }
}
