import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { extractReviewRequests } from '../scripts/lib/github/review-requests.js'

async function loadFixture() {
  return JSON.parse(await readFile('tests/fixtures/github-review-requests.json', 'utf8'))
}

test('AC1: every review request has all required fields populated', async () => {
  const instances = await loadFixture()
  const out = extractReviewRequests(instances)

  assert.ok(out.length > 0, 'expected at least one review request')
  for (const item of out) {
    assert.deepEqual(
      Object.keys(item).sort(),
      ['author', 'instance', 'number', 'reason', 'repo', 'title', 'url'],
      'item must have exactly the required fields'
    )
    assert.equal(typeof item.instance, 'string')
    assert.match(item.repo, /^octo-org\//, 'repo is owner/name')
    assert.equal(typeof item.number, 'number', 'number is a number')
    assert.ok(Number.isInteger(item.number), 'number is an integer')
    assert.equal(typeof item.title, 'string')
    assert.ok(item.title.length > 0)
    assert.equal(typeof item.author, 'string')
    assert.ok(item.url && item.url.length > 0)
    assert.equal(item.reason, 'review requested', 'reason is human string, not raw enum')
  }
})

test('AC2: authored, mention, and CI notifications are filtered out', async () => {
  const instances = await loadFixture()
  const out = extractReviewRequests(instances)

  // Only the two review_requested PRs (one per surface) should survive.
  assert.equal(out.length, 2)

  const noiseTitles = [
    'Refactor auth middleware',
    'Docs: clarify onboarding flow',
    'Bump build toolchain',
    'Add metrics for ledger writes',
    'Investigate slow settlement job',
    'Flaky integration test fix'
  ]
  const outTitles = out.map(i => i.title)
  for (const noisy of noiseTitles) {
    assert.ok(!outTitles.includes(noisy), `noise item "${noisy}" must not be present`)
  }

  const outUrls = out.map(i => i.url)
  assert.ok(!outUrls.some(u => u.includes('/pull/477')), 'authored PR url must not appear')
  assert.ok(!outUrls.some(u => u.includes('/issues/512')), 'mention issue url must not appear')
  assert.ok(!outUrls.some(u => u.includes('/pull/490')), 'CI PR url must not appear')
})

test('AC1: numbers are derived correctly from notifications', async () => {
  const instances = await loadFixture()
  const out = extractReviewRequests(instances)
  const byRepo = Object.fromEntries(out.map(i => [i.repo, i]))

  assert.equal(byRepo['octo-org/web-frontend'].number, 482)
  assert.equal(byRepo['octo-org/payments-service'].number, 1204)
})

test('AC1: PR number falls back to subject.url when html url is absent', () => {
  // Real runBrief output has no `subject` field (enrichNotification drops it),
  // so the primary path derives the number from the enriched html `url`. This
  // guards the defensive fallback for any caller passing a raw (unenriched)
  // notification that only carries `subject.url` (.../pulls/NNN).
  const instances = [
    {
      instance: 'github.com',
      notifications: [
        {
          id: 'raw-1',
          reason: 'review_requested',
          repository: { full_name: 'octo-org/raw-repo' },
          subject: {
            title: 'Unenriched PR',
            type: 'PullRequest',
            url: 'https://api.github.com/repos/octo-org/raw-repo/pulls/777'
          }
        }
      ]
    }
  ]
  const out = extractReviewRequests(instances)
  assert.equal(out.length, 1)
  assert.equal(out[0].number, 777, 'number derived from subject.url fallback')
  assert.equal(out[0].repo, 'octo-org/raw-repo', 'repo derived from repository.full_name')
  assert.equal(out[0].title, 'Unenriched PR', 'title derived from subject.title')
})

test('AC3: both surfaces appear when both are present', async () => {
  const instances = await loadFixture()
  const out = extractReviewRequests(instances)
  const surfaces = new Set(out.map(i => i.instance))

  assert.ok(surfaces.has('github.com'))
  assert.ok(surfaces.has('corporate'))
})

test('AC3: filtering to a single surface yields only that surface', async () => {
  const instances = await loadFixture()
  const comOnly = instances.filter(i => i.instance === 'github.com')
  const out = extractReviewRequests(comOnly)

  assert.equal(out.length, 1)
  assert.equal(out[0].instance, 'github.com')
  assert.equal(out[0].repo, 'octo-org/web-frontend')
})

test('robustness: notifications missing fields do not throw', () => {
  const instances = [
    {
      instance: 'github.com',
      notifications: [
        // missing subject, repository, url, author entirely
        { id: 'x', reason: 'review_requested' },
        // review_requested but only a repo string
        { id: 'y', reason: 'review_requested', repo: 'octo-org/thing' },
        // noise with missing fields
        { id: 'z', reason: 'author' },
        // completely empty object
        {}
      ]
    },
    // malformed instance entry (no notifications array)
    { instance: 'corporate' }
  ]

  let out
  assert.doesNotThrow(() => {
    out = extractReviewRequests(instances)
  })
  // Both review_requested items survive despite missing fields.
  assert.equal(out.length, 2)
  for (const item of out) {
    assert.deepEqual(
      Object.keys(item).sort(),
      ['author', 'instance', 'number', 'reason', 'repo', 'title', 'url']
    )
    assert.equal(item.reason, 'review requested')
  }
  // number may be null when it cannot be derived
  assert.ok(out.every(i => i.number === null || typeof i.number === 'number'))
})

test('robustness: non-array input returns empty array', () => {
  assert.deepEqual(extractReviewRequests(null), [])
  assert.deepEqual(extractReviewRequests(undefined), [])
  assert.deepEqual(extractReviewRequests({}), [])
})
