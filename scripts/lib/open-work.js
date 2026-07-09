/**
 * Day-aware selection rule for the "Open Work" radar (slice 009-03). No
 * network, no fs, no process.env — deterministic and `now`-injectable, like
 * the two sibling staleness libs it composes on top of.
 *
 * Consumes the already-classified output of lib/github/open-prs.js's
 * extractOpenPrs and lib/jira/staleness.js's extractInProgress — this module
 * does no new fetching or classification, only the cadence rule (Assumption
 * A3, spec 009 overview):
 *
 *   - Every day: stale-only — only `stale`/`very-stale` items, so the daily
 *     brief stays lean.
 *   - Mondays: full inventory — every open PR and in-progress ticket,
 *     including `fresh`, so the week starts with the whole picture.
 *
 * Read-only throughout: this module only selects and counts. It never
 * fetches, comments, merges, or transitions anything.
 *
 * Used by: scripts/list-open-work.js
 * Reference: docs/specs/009-open-work-radar/slice-03-monday-full-inventory.md
 */

/**
 * Is `now` a Monday in the runtime's local day? Mirrors the Monday-detection
 * convention already used for the ai-radar weekly section
 * (scripts/lib/ai-radar/render.js's `isMonday`) and the brief's 72h lookback
 * auto-bump (skills/morning-assistant/SKILL.md).
 * @param {Date} [now]
 * @returns {boolean}
 */
export function isMondayInventory(now = new Date()) {
  return now.getDay() === 1
}

/**
 * Select which open-work items to surface for this run, applying the
 * Monday-vs-weekday cadence rule. `prs` and `tickets` are expected to already
 * be staleness-tagged and most-stale-first sorted (the extractOpenPrs /
 * extractInProgress output shape) — this function preserves that order, it
 * never re-sorts.
 *
 * @param {object} [options]
 * @param {Array<{staleness: 'fresh'|'stale'|'very-stale'}>} [options.prs] - extractOpenPrs() output
 * @param {Array<{staleness: 'fresh'|'stale'|'very-stale'}>} [options.tickets] - extractInProgress() output
 * @param {Date} [options.now]
 * @returns {{
 *   mondayInventory: boolean,
 *   prs: object[],
 *   tickets: object[],
 *   suppressedFreshCount: number,
 *   isEmpty: boolean
 * }}
 */
export function selectOpenWork({ prs = [], tickets = [], now = new Date() } = {}) {
  const safePrs = Array.isArray(prs) ? prs : []
  const safeTickets = Array.isArray(tickets) ? tickets : []

  // isEmpty reflects the total open-work set BEFORE staleness filtering — a
  // Monday with only fresh items is not "empty", but a run with truly no
  // open PRs and no in-progress tickets at all is (AC5).
  const isEmpty = safePrs.length === 0 && safeTickets.length === 0

  const mondayInventory = isMondayInventory(now)

  if (mondayInventory) {
    return {
      mondayInventory,
      prs: safePrs,
      tickets: safeTickets,
      suppressedFreshCount: 0,
      isEmpty
    }
  }

  const filteredPrs = safePrs.filter(item => item?.staleness !== 'fresh')
  const filteredTickets = safeTickets.filter(item => item?.staleness !== 'fresh')
  const suppressedFreshCount =
    (safePrs.length - filteredPrs.length) + (safeTickets.length - filteredTickets.length)

  return {
    mondayInventory,
    prs: filteredPrs,
    tickets: filteredTickets,
    suppressedFreshCount,
    isEmpty
  }
}
