/**
 * Pure staleness classification + extraction for the user's assigned
 * in-progress JIRA tickets. No network, no fs, no process.env — deterministic.
 *
 * Consumes the runInProgress() output shape: an array of issues already
 * mapped through fetch-jira.js's `formatIssue` (lib/jira/query.js) — i.e.
 * objects with `key`, `summary`, `status` (the concrete status name, e.g.
 * "In Review" — never the statusCategory), `priority`, `updatedAt`, `url`.
 * Produces a flat, normalized list tagged with a staleness class (fresh /
 * stale / very-stale) based on **business-day** age since `updatedAt` —
 * weekends never count toward staleness (Assumption A2, spec 009).
 *
 * Read-only throughout: this module only reads and classifies. It never
 * transitions, comments on, or otherwise mutates a ticket.
 *
 * Used by: scripts/list-inprogress.js
 * Reference: docs/specs/009-open-work-radar/slice-02-jira-inprogress-staleness.md
 */

/** Default "no update" threshold (business days) before a ticket is tagged stale. */
export const DEFAULT_STALE_BUSINESS_DAYS = 3

/** Default "no update" threshold (business days) before a ticket is tagged very-stale. */
export const DEFAULT_VERY_STALE_BUSINESS_DAYS = 5

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
 * Count the whole business days (Mon-Fri) elapsed between `from` and `to`,
 * excluding weekends. Both timestamps are normalized to UTC midnight first,
 * so only calendar-date changes are counted — time-of-day differences (e.g.
 * updated 11pm vs. read 6am next day) never inflate or deflate the count on
 * their own. `to` at or before `from`'s calendar date returns 0.
 *
 * Example: a ticket updated Friday, read the following Monday, is exactly 1
 * business day old (Saturday and Sunday don't count) — not 3 calendar days.
 *
 * @param {string|Date} from - Earlier timestamp (e.g. the ticket's `updated`)
 * @param {string|Date} to - Later "now" timestamp
 * @returns {number} Business days elapsed, or NaN if either input is unparsable
 */
export function businessDaysBetween(from, to) {
  const fromMs = toMs(from)
  const toMsValue = toMs(to)
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMsValue)) return NaN

  const fromDate = new Date(fromMs)
  fromDate.setUTCHours(0, 0, 0, 0)
  const toDate = new Date(toMsValue)
  toDate.setUTCHours(0, 0, 0, 0)

  if (toDate <= fromDate) return 0

  let count = 0
  const cursor = new Date(fromDate)
  while (cursor < toDate) {
    cursor.setUTCDate(cursor.getUTCDate() + 1)
    const day = cursor.getUTCDay() // 0 = Sunday, 6 = Saturday
    if (day !== 0 && day !== 6) count++
  }
  return count
}

/**
 * Classify a ticket's staleness from its last-update timestamp, in business
 * days (weekends excluded).
 * @param {string|Date} updatedAt - Ticket's `updated` field
 * @param {string|Date} now - Reference "now" timestamp
 * @param {{ staleDays?: number, veryStaleDays?: number }} [thresholds]
 * @returns {'fresh'|'stale'|'very-stale'}
 */
export function classifyTicketStaleness(updatedAt, now, thresholds = {}) {
  const { staleDays = DEFAULT_STALE_BUSINESS_DAYS, veryStaleDays = DEFAULT_VERY_STALE_BUSINESS_DAYS } = thresholds
  const age = businessDaysBetween(updatedAt, now)

  // An unknown/unparsable age surfaces as very-stale — better to over-surface
  // a ticket for the user's attention than to silently drop it from the
  // stale list.
  if (Number.isNaN(age)) return 'very-stale'
  if (age >= veryStaleDays) return 'very-stale'
  if (age >= staleDays) return 'stale'
  return 'fresh'
}

/**
 * Extract and normalize the user's in-progress tickets, tagging each with
 * its staleness class. Sorted most-stale-first (largest business-day age
 * first; an unknown age sorts to the top, treated as oldest).
 * @param {object[]} issues - Issues already mapped by fetch-jira.js's `formatIssue`
 * @param {{ now?: string|Date, thresholds?: { staleDays?: number, veryStaleDays?: number } }} [options]
 * @returns {Array<{ key: string|null, summary: string|null, status: string, priority: string, url: string|null, updatedAt: string|null, ageBusinessDays: number|null, staleness: 'fresh'|'stale'|'very-stale' }>}
 */
export function extractInProgress(issues, { now = new Date(), thresholds = {} } = {}) {
  if (!Array.isArray(issues)) return []

  const out = []
  for (const issue of issues) {
    if (!issue || typeof issue !== 'object') continue

    const updatedAt = issue.updatedAt ?? null
    const age = businessDaysBetween(updatedAt, now)

    out.push({
      key: issue.key ?? null,
      summary: issue.summary ?? null,
      status: issue.status ?? 'Unknown',
      priority: issue.priority ?? 'Unknown',
      url: issue.url ?? null,
      updatedAt,
      ageBusinessDays: Number.isNaN(age) ? null : age,
      staleness: classifyTicketStaleness(updatedAt, now, thresholds)
    })
  }

  // Most-stale first; an unknown age (null) sorts to the top (treated as oldest).
  out.sort((a, b) => (b.ageBusinessDays ?? Infinity) - (a.ageBusinessDays ?? Infinity))
  return out
}
