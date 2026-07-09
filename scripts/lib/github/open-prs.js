/**
 * Pure staleness classification + extraction for the user's own open authored
 * PRs. No network, no fs, no process.env — deterministic.
 *
 * Consumes the runOpenPrs() output shape: an array of { instance, prs }
 * objects (see lib/github.js runOpenPrs), where `prs` is the raw
 * `/search/issues` item payload for each instance. Produces a flat,
 * normalized list of open authored PRs tagged with a staleness class
 * (fresh / stale / very-stale) based on calendar-day age since `updated_at`.
 *
 * Read-only throughout: this module only reads and classifies. It never
 * comments, merges, closes, or otherwise mutates a PR.
 *
 * Used by: scripts/list-open-prs.js
 * Reference: docs/specs/009-open-work-radar/slice-01-github-open-pr-staleness.md
 */

/** Milliseconds in a day, used for calendar-day age math. */
const MS_PER_DAY = 24 * 60 * 60 * 1000

/** Default "no activity" threshold (days) before a PR is tagged stale. */
export const DEFAULT_STALE_DAYS = 3

/** Default "no activity" threshold (days) before a PR is tagged very-stale. */
export const DEFAULT_VERY_STALE_DAYS = 7

/**
 * Convert a Date or ISO string into epoch milliseconds.
 * @param {string|Date} value
 * @returns {number} epoch ms, or NaN if unparsable
 */
function toMs(value) {
  if (value instanceof Date) return value.getTime()
  // Guard null/undefined/'' explicitly: `new Date(null)` is epoch 0 (a valid
  // finite time), which would misreport a missing timestamp as an ancient one.
  if (value == null || value === '') return NaN
  return new Date(value).getTime()
}

/**
 * Calendar-day age between `now` and `updatedAt` (floor of whole days
 * elapsed). Returns NaN for a missing/unparsable timestamp rather than
 * throwing — callers treat an unknown age as very-stale so the PR is
 * surfaced (never silently hidden from the stale list).
 * @param {string|Date} updatedAt
 * @param {string|Date} now
 * @returns {number}
 */
function ageInDays(updatedAt, now) {
  const nowMs = toMs(now)
  const updatedMs = toMs(updatedAt)
  if (!Number.isFinite(nowMs) || !Number.isFinite(updatedMs)) return NaN
  return Math.floor((nowMs - updatedMs) / MS_PER_DAY)
}

/**
 * Derive "owner/repo" from a search-issue item.
 * @param {object} item - Raw /search/issues item
 * @returns {string|null}
 */
function deriveRepo(item) {
  if (typeof item?.repository_url === 'string') {
    return item.repository_url.replace(/.*\/repos\//, '')
  }
  if (item?.repository?.full_name) return item.repository.full_name
  return null
}

/**
 * Classify a PR's staleness from its last-activity timestamp.
 * @param {string|Date} updatedAt - PR's `updated_at` (latest push/comment/review)
 * @param {string|Date} now - Reference "now" timestamp
 * @param {{ staleDays?: number, veryStaleDays?: number }} [thresholds]
 * @returns {'fresh'|'stale'|'very-stale'}
 */
export function classifyPrStaleness(updatedAt, now, thresholds = {}) {
  const { staleDays = DEFAULT_STALE_DAYS, veryStaleDays = DEFAULT_VERY_STALE_DAYS } = thresholds
  const age = ageInDays(updatedAt, now)

  // An unknown/unparsable age surfaces as very-stale — better to over-surface a
  // PR for the user's attention than to silently drop it from the stale list.
  if (Number.isNaN(age)) return 'very-stale'
  if (age >= veryStaleDays) return 'very-stale'
  if (age >= staleDays) return 'stale'
  return 'fresh'
}

/**
 * Extract and normalize the user's open authored PRs across one or more
 * GitHub instances, tagging each with its staleness class. Sorted
 * most-stale-first (largest age in days first).
 * @param {Array<{ instance: string, prs: object[] }>} instances
 * @param {{ now?: string|Date, thresholds?: { staleDays?: number, veryStaleDays?: number } }} [options]
 * @returns {Array<{ instance: string, repo: string|null, number: number|null, title: string|null, url: string|null, isDraft: boolean, updatedAt: string|null, ageDays: number, staleness: 'fresh'|'stale'|'very-stale' }>}
 */
export function extractOpenPrs(instances, { now = new Date(), thresholds = {} } = {}) {
  if (!Array.isArray(instances)) return []

  const out = []
  for (const surface of instances) {
    if (!surface || typeof surface !== 'object') continue
    const instance = surface.instance ?? 'unknown'
    const prs = Array.isArray(surface.prs) ? surface.prs : []

    for (const item of prs) {
      if (!item || typeof item !== 'object') continue
      const updatedAt = item.updated_at ?? null
      const age = ageInDays(updatedAt, now)

      out.push({
        instance,
        repo: deriveRepo(item),
        number: item.number ?? null,
        title: item.title ?? null,
        url: item.html_url ?? null,
        isDraft: item.draft ?? false,
        updatedAt,
        ageDays: Number.isNaN(age) ? null : age,
        staleness: classifyPrStaleness(updatedAt, now, thresholds)
      })
    }
  }

  // Most-stale first; an unknown age (null) sorts to the top (treated as oldest).
  out.sort((a, b) => (b.ageDays ?? Infinity) - (a.ageDays ?? Infinity))
  return out
}
