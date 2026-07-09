import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { isMondayInventory, selectOpenWork } from '../scripts/lib/open-work.js'
import { extractOpenPrs } from '../scripts/lib/github/open-prs.js'
import { extractInProgress } from '../scripts/lib/jira/staleness.js'

// A Monday and a Wednesday (adjacent weeks) — reused across the
// Monday-inventory and non-Monday-stale-only branches so the two branches
// are exercised over materially the same fixture data (DoD).
const MONDAY = new Date('2026-07-13T09:00:00Z')
const WEDNESDAY = new Date('2026-07-08T09:00:00Z')

async function loadPrs(now) {
  const instances = JSON.parse(await readFile('tests/fixtures/github-open-prs.json', 'utf8'))
  return extractOpenPrs(instances, { now })
}

async function loadTickets(now) {
  const issues = JSON.parse(await readFile('tests/fixtures/jira-inprogress.json', 'utf8'))
  return extractInProgress(issues, { now })
}

test('isMondayInventory: true on a Monday', () => {
  assert.equal(isMondayInventory(MONDAY), true)
})

test('isMondayInventory: false on a non-Monday', () => {
  assert.equal(isMondayInventory(WEDNESDAY), false)
})

test('isMondayInventory: defaults to new Date() when called with no argument', () => {
  // Just confirm it doesn't throw and returns a boolean — the "now" default
  // is exercised by list-open-work.js in production, not asserted on a
  // specific day here (that would make the test's pass/fail depend on the
  // day it happens to run).
  assert.equal(typeof isMondayInventory(), 'boolean')
})

test('AC1/AC2: Monday selection returns the full inventory, fresh items included and flagged', async () => {
  const prs = await loadPrs(MONDAY)
  const tickets = await loadTickets(MONDAY)

  const result = selectOpenWork({ prs, tickets, now: MONDAY })

  assert.equal(result.mondayInventory, true)
  assert.equal(result.suppressedFreshCount, 0)
  assert.equal(result.isEmpty, false)

  // Every item from both sources survives — nothing withheld on Monday.
  assert.equal(result.prs.length, prs.length)
  assert.equal(result.tickets.length, tickets.length)
  assert.deepEqual(result.prs, prs)
  assert.deepEqual(result.tickets, tickets)

  // At least one fresh item exists in the fixture set at this `now` (the
  // JIRA ticket SITES-100) and it is present, still flagged `fresh` — not
  // dropped, not relabeled.
  const freshTicket = result.tickets.find(t => t.key === 'SITES-100')
  assert.ok(freshTicket, 'the fresh ticket is present in the Monday inventory')
  assert.equal(freshTicket.staleness, 'fresh')

  // Stale/very-stale items keep their flags too, so they still stand out
  // within the fuller list (AC2).
  assert.ok(result.prs.some(pr => pr.staleness === 'very-stale'))
  assert.ok(result.tickets.some(t => t.staleness === 'very-stale'))
})

test('AC4: Monday selection preserves each list\'s most-stale-first order', async () => {
  const prs = await loadPrs(MONDAY)
  const tickets = await loadTickets(MONDAY)
  const result = selectOpenWork({ prs, tickets, now: MONDAY })

  assert.deepEqual(result.prs.map(pr => pr.number), prs.map(pr => pr.number))
  assert.deepEqual(result.tickets.map(t => t.key), tickets.map(t => t.key))
})

test('AC3: non-Monday selection withholds fresh items and counts them, over the same fixture data', async () => {
  const prs = await loadPrs(WEDNESDAY)
  const tickets = await loadTickets(WEDNESDAY)
  const freshPrCount = prs.filter(pr => pr.staleness === 'fresh').length
  const freshTicketCount = tickets.filter(t => t.staleness === 'fresh').length

  // Sanity: this fixture/`now` combination actually has fresh items to
  // withhold, otherwise the assertions below would pass vacuously.
  assert.ok(freshPrCount > 0, 'fixture has at least one fresh PR at this now')
  assert.ok(freshTicketCount > 0, 'fixture has at least one fresh ticket at this now')

  const result = selectOpenWork({ prs, tickets, now: WEDNESDAY })

  assert.equal(result.mondayInventory, false)
  assert.equal(result.isEmpty, false)
  assert.ok(result.prs.every(pr => pr.staleness !== 'fresh'), 'no fresh PRs leak into a non-Monday selection')
  assert.ok(result.tickets.every(t => t.staleness !== 'fresh'), 'no fresh tickets leak into a non-Monday selection')
  assert.equal(result.suppressedFreshCount, freshPrCount + freshTicketCount)
})

test('AC3/AC4: non-Monday selection preserves most-stale-first order among the retained items', async () => {
  const prs = await loadPrs(WEDNESDAY)
  const tickets = await loadTickets(WEDNESDAY)
  const result = selectOpenWork({ prs, tickets, now: WEDNESDAY })

  const expectedPrOrder = prs.filter(pr => pr.staleness !== 'fresh').map(pr => pr.number)
  const expectedTicketOrder = tickets.filter(t => t.staleness !== 'fresh').map(t => t.key)

  assert.deepEqual(result.prs.map(pr => pr.number), expectedPrOrder)
  assert.deepEqual(result.tickets.map(t => t.key), expectedTicketOrder)
})

test('AC5: empty inventory (no PRs, no tickets) reports isEmpty on a Monday', () => {
  const result = selectOpenWork({ prs: [], tickets: [], now: MONDAY })

  assert.equal(result.isEmpty, true)
  assert.equal(result.mondayInventory, true)
  assert.deepEqual(result.prs, [])
  assert.deepEqual(result.tickets, [])
  assert.equal(result.suppressedFreshCount, 0)
})

test('AC5: empty inventory (no PRs, no tickets) reports isEmpty on a non-Monday', () => {
  const result = selectOpenWork({ prs: [], tickets: [], now: WEDNESDAY })

  assert.equal(result.isEmpty, true)
  assert.equal(result.mondayInventory, false)
  assert.deepEqual(result.prs, [])
  assert.deepEqual(result.tickets, [])
  assert.equal(result.suppressedFreshCount, 0)
})

test('non-Monday with only fresh items: not empty, all withheld — drives section suppression', () => {
  // The section-suppression case: there IS open work, but none of it is stale,
  // so a weekday shows nothing while isEmpty stays false (distinct from "no
  // open work at all"). The orchestrator suppresses the section on shown-empty.
  const prs = [{ number: 1, staleness: 'fresh' }, { number: 2, staleness: 'fresh' }]
  const tickets = [{ key: 'SITES-1', staleness: 'fresh' }]
  const result = selectOpenWork({ prs, tickets, now: WEDNESDAY })

  assert.equal(result.isEmpty, false, 'there is open work, so not empty')
  assert.deepEqual(result.prs, [], 'no stale PRs to show on a weekday')
  assert.deepEqual(result.tickets, [], 'no stale tickets to show on a weekday')
  assert.equal(result.suppressedFreshCount, 3)
})

test('robustness: selectOpenWork defaults prs/tickets to empty arrays when omitted or malformed', () => {
  assert.equal(selectOpenWork({ now: WEDNESDAY }).isEmpty, true)
  assert.deepEqual(selectOpenWork({ prs: null, tickets: undefined, now: WEDNESDAY }).prs, [])
  assert.deepEqual(selectOpenWork({ prs: null, tickets: undefined, now: WEDNESDAY }).tickets, [])
})
