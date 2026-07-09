import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  classifyPrStaleness,
  extractOpenPrs,
  DEFAULT_STALE_DAYS,
  DEFAULT_VERY_STALE_DAYS
} from '../scripts/lib/github/open-prs.js'

async function loadFixture() {
  return JSON.parse(await readFile('tests/fixtures/github-open-prs.json', 'utf8'))
}

const NOW = new Date('2026-07-09T12:00:00Z')

test('AC2: classifyPrStaleness — defaults are 3/7 days', () => {
  assert.equal(DEFAULT_STALE_DAYS, 3)
  assert.equal(DEFAULT_VERY_STALE_DAYS, 7)
})

test('AC2: classifyPrStaleness — under 3 days is fresh', () => {
  // 2 days 23 hours ago — just under the 3-day stale threshold.
  const updatedAt = new Date(NOW.getTime() - (2 * 24 + 23) * 60 * 60 * 1000)
  assert.equal(classifyPrStaleness(updatedAt, NOW), 'fresh')
})

test('AC2: classifyPrStaleness — exactly 3 days is stale', () => {
  const updatedAt = new Date(NOW.getTime() - 3 * 24 * 60 * 60 * 1000)
  assert.equal(classifyPrStaleness(updatedAt, NOW), 'stale')
})

test('AC2: classifyPrStaleness — just under 7 days is still stale', () => {
  const updatedAt = new Date(NOW.getTime() - (6 * 24 + 23) * 60 * 60 * 1000)
  assert.equal(classifyPrStaleness(updatedAt, NOW), 'stale')
})

test('AC2: classifyPrStaleness — exactly 7 days is very-stale', () => {
  const updatedAt = new Date(NOW.getTime() - 7 * 24 * 60 * 60 * 1000)
  assert.equal(classifyPrStaleness(updatedAt, NOW), 'very-stale')
})

test('AC2: classifyPrStaleness — well past 7 days is very-stale', () => {
  const updatedAt = new Date(NOW.getTime() - 19 * 24 * 60 * 60 * 1000)
  assert.equal(classifyPrStaleness(updatedAt, NOW), 'very-stale')
})

test('AC2: classifyPrStaleness — respects configurable thresholds', () => {
  const updatedAt = new Date(NOW.getTime() - 4 * 24 * 60 * 60 * 1000)
  // Default thresholds (3/7) would call this "stale".
  assert.equal(classifyPrStaleness(updatedAt, NOW), 'stale')
  // A wider threshold set keeps the same PR "fresh".
  assert.equal(
    classifyPrStaleness(updatedAt, NOW, { staleDays: 5, veryStaleDays: 10 }),
    'fresh'
  )
})

test('AC1/AC2/AC2a: extractOpenPrs normalizes fields, flags drafts, tags staleness', async () => {
  const instances = await loadFixture()
  const out = extractOpenPrs(instances, { now: NOW })

  assert.equal(out.length, 4, 'all PRs across both instances are present')

  for (const pr of out) {
    assert.deepEqual(
      Object.keys(pr).sort(),
      ['ageDays', 'instance', 'isDraft', 'number', 'repo', 'staleness', 'title', 'updatedAt', 'url']
    )
  }

  const byNumber = Object.fromEntries(out.map(pr => [pr.number, pr]))

  // AC1 — normalization: repo, url passthrough (html_url, not constructed).
  assert.equal(byNumber[501].repo, 'acme/foo')
  assert.equal(byNumber[501].url, 'https://github.com/acme/foo/pull/501')
  assert.equal(byNumber[501].instance, 'github.com')
  assert.equal(byNumber[80].repo, 'acme/bar')
  assert.equal(byNumber[80].url, 'https://ghe.example.com/acme/bar/pull/80')
  assert.equal(byNumber[80].instance, 'corporate')

  // AC2 — staleness classification.
  assert.equal(byNumber[501].staleness, 'fresh')
  assert.equal(byNumber[501].ageDays, 0)
  assert.equal(byNumber[499].staleness, 'stale')
  assert.equal(byNumber[499].ageDays, 3)
  assert.equal(byNumber[77].staleness, 'very-stale')
  assert.equal(byNumber[77].ageDays, 7)
  assert.equal(byNumber[80].staleness, 'very-stale')
  assert.equal(byNumber[80].ageDays, 19)

  // AC2a — draft PRs are distinguishable.
  assert.equal(byNumber[77].isDraft, true, 'draft PR is flagged')
  assert.equal(byNumber[501].isDraft, false)
  assert.equal(byNumber[499].isDraft, false)
  assert.equal(byNumber[80].isDraft, false)
})

test('extractOpenPrs sorts most-stale-first (largest ageDays first)', async () => {
  const instances = await loadFixture()
  const out = extractOpenPrs(instances, { now: NOW })
  const order = out.map(pr => pr.number)

  assert.deepEqual(order, [80, 77, 499, 501])
})

test('extractOpenPrs — empty result returns empty array', () => {
  assert.deepEqual(extractOpenPrs([], { now: NOW }), [])
  assert.deepEqual(extractOpenPrs([{ instance: 'github.com', prs: [] }], { now: NOW }), [])
})

test('AC5: fault isolation — an instance dropped by the runner (fetch errored) does not remove the other instance\'s PRs', async () => {
  const instances = await loadFixture()
  // Simulate the runner's gather shape: list-open-prs.js runs
  // `Promise.all(surfaces.map(gatherSurface))` then `.filter(Boolean)` to drop
  // any instance whose fetch threw (auth/VPN/API failure) before ever calling
  // extractOpenPrs. Here the "corporate" surface is simply absent, as if its
  // gatherSurface() call returned null and was filtered out upstream.
  const survivingInstances = instances.filter(i => i.instance === 'github.com')

  const out = extractOpenPrs(survivingInstances, { now: NOW })

  assert.equal(out.length, 2)
  assert.ok(out.every(pr => pr.instance === 'github.com'), 'only the surviving instance\'s PRs are present')
  assert.deepEqual(out.map(pr => pr.number).sort(), [499, 501])
})

test('robustness: malformed instance entries do not throw and do not drop valid ones', () => {
  const instances = [
    { instance: 'github.com', prs: [
      {
        number: 1,
        title: 'ok pr',
        html_url: 'https://github.com/acme/foo/pull/1',
        repository_url: 'https://api.github.com/repos/acme/foo',
        draft: false,
        updated_at: NOW.toISOString()
      }
    ] },
    // Malformed instance entry — no `prs` array at all (as if its fetch
    // partially failed and gatherSurface returned a bare shape).
    { instance: 'corporate' },
    // Non-object / null entries mixed in.
    null,
    {}
  ]

  let out
  assert.doesNotThrow(() => {
    out = extractOpenPrs(instances, { now: NOW })
  })
  assert.equal(out.length, 1)
  assert.equal(out[0].instance, 'github.com')
  assert.equal(out[0].number, 1)
})

test('robustness: non-array input returns empty array', () => {
  assert.deepEqual(extractOpenPrs(null), [])
  assert.deepEqual(extractOpenPrs(undefined), [])
  assert.deepEqual(extractOpenPrs({}), [])
})

test('a missing/unparsable updated_at surfaces as very-stale (never hidden)', () => {
  // Regression for the review note: an unknown age must not degrade to "fresh"
  // (which would silently drop the PR from the stale-only daily list).
  assert.equal(classifyPrStaleness(null, NOW), 'very-stale')
  assert.equal(classifyPrStaleness(undefined, NOW), 'very-stale')
  assert.equal(classifyPrStaleness('not-a-date', NOW), 'very-stale')
})

test('extractOpenPrs — a PR with no updated_at is very-stale, ageDays null, sorted first', () => {
  const instances = [
    { instance: 'github.com', prs: [
      { number: 1, title: 'timestamped', html_url: 'https://github.com/acme/foo/pull/1',
        repository_url: 'https://api.github.com/repos/acme/foo', draft: false,
        updated_at: new Date(NOW.getTime() - 4 * 24 * 60 * 60 * 1000).toISOString() },
      { number: 2, title: 'no timestamp', html_url: 'https://github.com/acme/foo/pull/2',
        repository_url: 'https://api.github.com/repos/acme/foo', draft: false }
    ] }
  ]
  const out = extractOpenPrs(instances, { now: NOW })
  const byNumber = Object.fromEntries(out.map(pr => [pr.number, pr]))

  assert.equal(byNumber[2].staleness, 'very-stale')
  assert.equal(byNumber[2].ageDays, null)
  assert.equal(byNumber[1].staleness, 'stale')
  // Unknown-age PR sorts to the top (treated as oldest).
  assert.equal(out[0].number, 2)
})
