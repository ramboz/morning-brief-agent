/**
 * Pure extraction of "PRs you were asked to review" from enriched GitHub
 * notification streams. No network, no fs, no process.env — deterministic.
 *
 * Consumes the post-`runBrief` shape: an array of { instance, notifications }
 * objects (see lib/github.js runBrief). Produces a flat, normalized queue
 * containing ONLY review requests, filtering out authored PR activity,
 * mentions, CI updates, and any other notification reason.
 *
 * Note on the review_requested predicate: this is deliberately a second,
 * defensive filter. `runBrief` already applies `notificationPassesFilter`
 * (lib/github.js), which drops review_requested notifications upstream when a
 * surface config sets `notifications.prs_to_review: false`. The CLI keeps that
 * flag true via DEFAULT_CONFIG, so in practice both filters agree; the
 * redundancy here keeps this a self-contained transform for direct callers/tests.
 *
 * Used by: scripts/list-review-requests.js
 */

/** Notification reason that signals a review request. */
const REVIEW_REQUESTED = 'review_requested'

/** Human-readable reason surfaced in the output. */
const REVIEW_REQUESTED_LABEL = 'review requested'

/**
 * Derive the PR number from a notification.
 * Tries the enriched html url (.../pull/482) first, then the raw
 * subject.url (.../pulls/482). Returns null when it can't be found.
 * @param {object} n - A (possibly enriched) notification object
 * @returns {number|null}
 */
function derivePrNumber(n) {
  const candidates = [n?.url, n?.subject?.url]
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue
    // Match trailing integer after /pull/ or /pulls/ (with optional query/hash)
    const match = candidate.match(/\/pulls?\/(\d+)(?:[/?#].*)?$/)
    if (match) return parseInt(match[1], 10)
  }
  return null
}

/**
 * Normalize a single review-request notification into the output shape.
 * @param {string} instance - Surface label (e.g. "github.com", "corporate")
 * @param {object} n - Enriched (or partially enriched) notification
 * @returns {{ instance: string, repo: string, number: number|null, title: string, author: string|null, url: string|null, reason: string }}
 */
function normalize(instance, n) {
  const repo = n?.repo ?? n?.repository?.full_name ?? null
  const title = n?.title ?? n?.subject?.title ?? null
  const author = n?.author ?? null
  const url = n?.url ?? n?.subject?.url ?? null

  return {
    instance,
    repo,
    number: derivePrNumber(n),
    title,
    author,
    url,
    reason: REVIEW_REQUESTED_LABEL
  }
}

/**
 * Extract review requests across one or more GitHub surfaces.
 * @param {Array<{ instance: string, notifications: object[] }>} instances
 * @returns {Array<{ instance: string, repo: string|null, number: number|null, title: string|null, author: string|null, url: string|null, reason: string }>}
 */
export function extractReviewRequests(instances) {
  if (!Array.isArray(instances)) return []

  const out = []
  for (const surface of instances) {
    if (!surface || typeof surface !== 'object') continue
    const instance = surface.instance ?? 'unknown'
    const notifications = Array.isArray(surface.notifications) ? surface.notifications : []

    for (const n of notifications) {
      if (!n || typeof n !== 'object') continue
      if (n.reason !== REVIEW_REQUESTED) continue
      out.push(normalize(instance, n))
    }
  }

  return out
}
