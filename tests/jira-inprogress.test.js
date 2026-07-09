import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  businessDaysBetween,
  classifyTicketStaleness,
  extractInProgress,
  DEFAULT_STALE_BUSINESS_DAYS,
  DEFAULT_VERY_STALE_BUSINESS_DAYS
} from '../scripts/lib/jira/staleness.js'

async function loadFixture() {
  return JSON.parse(await readFile('tests/fixtures/jira-inprogress.json', 'utf8'))
}

// A Monday — chosen deliberately so the "updated Friday, read Monday" case
// (AC2/DoD) only spans one weekend, not two.
const NOW = new Date('2026-07-13T09:00:00Z')

test('AC2: defaults are 3/5 business days', () => {
  assert.equal(DEFAULT_STALE_BUSINESS_DAYS, 3)
  assert.equal(DEFAULT_VERY_STALE_BUSINESS_DAYS, 5)
})

test('businessDaysBetween: weekends are excluded from the count', () => {
  // Monday -> following Monday spans one weekend; only the 5 weekdays
  // (Tue, Wed, Thu, Fri, Mon) count, not the 7 calendar days.
  assert.equal(businessDaysBetween('2026-07-06T09:00:00Z', '2026-07-13T09:00:00Z'), 5)
})

test('businessDaysBetween: Friday to Monday is only 1 business day (not 3 calendar days)', () => {
  assert.equal(businessDaysBetween('2026-07-10T15:00:00Z', NOW), 1)
})

test('businessDaysBetween: same calendar day is 0', () => {
  assert.equal(businessDaysBetween('2026-07-13T02:00:00Z', '2026-07-13T23:00:00Z'), 0)
})

test('businessDaysBetween: unparsable/missing input returns NaN', () => {
  assert.ok(Number.isNaN(businessDaysBetween(null, NOW)))
  assert.ok(Number.isNaN(businessDaysBetween(undefined, NOW)))
  assert.ok(Number.isNaN(businessDaysBetween('not-a-date', NOW)))
  assert.ok(Number.isNaN(businessDaysBetween(NOW, 'not-a-date')))
})

test('AC2: classifyTicketStaleness — updated Friday, read Monday is fresh (NOT very-stale)', () => {
  // Regression for the business-day rule: this spans a weekend and must not
  // be miscounted as "3 days ago" (which would wrongly read as stale).
  assert.equal(classifyTicketStaleness('2026-07-10T15:00:00Z', NOW), 'fresh')
})

test('AC2: classifyTicketStaleness — just under 3 business days is fresh', () => {
  // Thursday -> Monday = 2 business days (Fri, Mon), skipping the weekend.
  assert.equal(classifyTicketStaleness('2026-07-09T09:00:00Z', NOW), 'fresh')
})

test('AC2: classifyTicketStaleness — exactly 3 business days is stale', () => {
  // Wednesday -> Monday = 3 business days (Thu, Fri, Mon).
  assert.equal(classifyTicketStaleness('2026-07-08T09:00:00Z', NOW), 'stale')
})

test('AC2: classifyTicketStaleness — 4 business days is still stale (just under 5)', () => {
  // Tuesday -> Monday = 4 business days (Wed, Thu, Fri, Mon).
  assert.equal(classifyTicketStaleness('2026-07-07T09:00:00Z', NOW), 'stale')
})

test('AC2: classifyTicketStaleness — exactly 5 business days is very-stale', () => {
  // Monday -> following Monday = 5 business days.
  assert.equal(classifyTicketStaleness('2026-07-06T09:00:00Z', NOW), 'very-stale')
})

test('AC2: classifyTicketStaleness — well past 5 business days is very-stale', () => {
  assert.equal(classifyTicketStaleness('2026-06-15T09:00:00Z', NOW), 'very-stale')
})

test('AC2: classifyTicketStaleness — respects configurable thresholds', () => {
  // 4 business days ago — default thresholds (3/5) call this "stale".
  assert.equal(classifyTicketStaleness('2026-07-07T09:00:00Z', NOW), 'stale')
  // A wider threshold set keeps the same ticket "fresh".
  assert.equal(
    classifyTicketStaleness('2026-07-07T09:00:00Z', NOW, { staleDays: 5, veryStaleDays: 10 }),
    'fresh'
  )
})

test('a missing/unparsable updated timestamp surfaces as very-stale (never hidden)', () => {
  assert.equal(classifyTicketStaleness(null, NOW), 'very-stale')
  assert.equal(classifyTicketStaleness(undefined, NOW), 'very-stale')
  assert.equal(classifyTicketStaleness('not-a-date', NOW), 'very-stale')
})

test('AC1/AC2: extractInProgress normalizes fields, tags staleness, keeps the concrete status name', async () => {
  const issues = await loadFixture()
  const out = extractInProgress(issues, { now: NOW })

  assert.equal(out.length, 4, 'all fixture tickets are present')

  for (const ticket of out) {
    assert.deepEqual(
      Object.keys(ticket).sort(),
      ['ageBusinessDays', 'key', 'priority', 'staleness', 'status', 'summary', 'updatedAt', 'url']
    )
  }

  const byKey = Object.fromEntries(out.map(t => [t.key, t]))

  // AC1 — normalization: url passthrough, concrete status name (not category).
  assert.equal(byKey['SITES-142'].status, 'In Review', 'concrete status name is preserved, not the category')
  assert.equal(byKey['SITES-142'].url, 'https://jira.example.com/browse/SITES-142')
  assert.equal(byKey['SITES-100'].status, 'In Progress')

  // AC2 — staleness classification.
  assert.equal(byKey['SITES-100'].staleness, 'fresh')
  assert.equal(byKey['SITES-100'].ageBusinessDays, 1)
  assert.equal(byKey['SITES-210'].staleness, 'stale')
  assert.equal(byKey['SITES-210'].ageBusinessDays, 3)
  assert.equal(byKey['SITES-142'].staleness, 'very-stale')
  assert.equal(byKey['SITES-142'].ageBusinessDays, 5)
})

test('extractInProgress sorts most-stale-first (largest ageBusinessDays first, unknown age first of all)', async () => {
  const issues = await loadFixture()
  const out = extractInProgress(issues, { now: NOW })
  const order = out.map(t => t.key)

  assert.deepEqual(order, ['SITES-305', 'SITES-142', 'SITES-210', 'SITES-100'])
})

test('extractInProgress — a ticket with no updated timestamp is very-stale, ageBusinessDays null, sorted first', async () => {
  const issues = await loadFixture()
  const out = extractInProgress(issues, { now: NOW })
  const missing = out.find(t => t.key === 'SITES-305')

  assert.equal(missing.staleness, 'very-stale')
  assert.equal(missing.ageBusinessDays, null)
  assert.equal(out[0].key, 'SITES-305')
})

test('extractInProgress — empty result returns empty array', () => {
  assert.deepEqual(extractInProgress([], { now: NOW }), [])
})

test('robustness: malformed issue entries do not throw and do not drop valid ones', () => {
  const issues = [
    {
      key: 'SITES-1',
      summary: 'ok ticket',
      status: 'In Progress',
      priority: 'Medium',
      updatedAt: NOW.toISOString(),
      url: 'https://jira.example.com/browse/SITES-1'
    },
    null,
    {},
    'not-an-object'
  ]

  let out
  assert.doesNotThrow(() => {
    out = extractInProgress(issues, { now: NOW })
  })
  assert.equal(out.length, 2, 'malformed entries fall back to safe defaults rather than being dropped')
  assert.ok(out.some(t => t.key === 'SITES-1'), 'the well-formed ticket survives')
  assert.ok(out.some(t => t.key === null), 'the empty-object entry surfaces as a degenerate ticket rather than being silently dropped')
})

test('robustness: non-array input returns empty array', () => {
  assert.deepEqual(extractInProgress(null), [])
  assert.deepEqual(extractInProgress(undefined), [])
  assert.deepEqual(extractInProgress({}), [])
})
