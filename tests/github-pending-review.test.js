import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { resolveStagingDecision } from '../scripts/lib/github/pending-review.js'
import { stagePendingReview } from '../scripts/lib/github.js'

/**
 * Stub globalThis.fetch. Returns a restore fn.
 * stagePendingReview reaches the network via githubPost -> global fetch, so this
 * exercises the helper end-to-end without any real request.
 */
function stubFetch(handler) {
  const original = globalThis.fetch
  globalThis.fetch = handler
  return () => { globalThis.fetch = original }
}

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    async json() { return body },
    async text() { return JSON.stringify(body) },
    headers: new Headers()
  }
}

/** Run scripts/stage-review-if-enabled.js with stdin JSON + args. */
function runScript(input, args = [], env = {}) {
  const res = spawnSync('node', ['scripts/stage-review-if-enabled.js', ...args], {
    input: JSON.stringify(input),
    encoding: 'utf-8',
    env: { ...process.env, ...env }
  })
  let envelope = null
  try {
    envelope = JSON.parse(res.stdout.trim())
  } catch { /* leave null */ }
  return { res, envelope }
}

// --- AC1: native staging is opt-in ---

test('AC1: resolveStagingDecision returns stage:false by default (enabled absent)', () => {
  const d = resolveStagingDecision({ instanceConfig: {}, owner: 'octo-org', repo: 'web-frontend' })
  assert.equal(d.stage, false)
  assert.match(d.reason, /disabled|opt-in|not enabled/i)
})

test('AC1: resolveStagingDecision returns stage:false when enabled:false', () => {
  const cfg = { pending_review_staging: { enabled: false, repos: ['web-frontend'] } }
  const d = resolveStagingDecision({ instanceConfig: cfg, owner: 'octo-org', repo: 'web-frontend' })
  assert.equal(d.stage, false)
})

test('AC1: resolveStagingDecision returns stage:false when enabled but repo not in non-empty allowlist', () => {
  const cfg = { pending_review_staging: { enabled: true, repos: ['other-repo'] } }
  const d = resolveStagingDecision({ instanceConfig: cfg, owner: 'octo-org', repo: 'web-frontend' })
  assert.equal(d.stage, false)
  assert.match(d.reason, /allowlist|not in|not listed/i)
})

test('AC1: resolveStagingDecision returns stage:true when enabled and repo in allowlist', () => {
  const cfg = { pending_review_staging: { enabled: true, repos: ['web-frontend'] } }
  const d = resolveStagingDecision({ instanceConfig: cfg, owner: 'octo-org', repo: 'web-frontend' })
  assert.equal(d.stage, true)
})

test('AC1: resolveStagingDecision matches allowlist entries as owner/repo too', () => {
  const cfg = { pending_review_staging: { enabled: true, repos: ['octo-org/web-frontend'] } }
  const d = resolveStagingDecision({ instanceConfig: cfg, owner: 'octo-org', repo: 'web-frontend' })
  assert.equal(d.stage, true)
})

test('AC1: resolveStagingDecision stages for all repos when enabled with empty allowlist', () => {
  const cfg = { pending_review_staging: { enabled: true, repos: [] } }
  const d = resolveStagingDecision({ instanceConfig: cfg, owner: 'octo-org', repo: 'anything' })
  assert.equal(d.stage, true)
  assert.match(d.reason, /all|empty/i)
})

test('AC1: resolveStagingDecision is pure and tolerates null config', () => {
  assert.doesNotThrow(() => resolveStagingDecision({ instanceConfig: null, owner: 'o', repo: 'r' }))
  const d = resolveStagingDecision({ instanceConfig: null, owner: 'o', repo: 'r' })
  assert.equal(d.stage, false)
})

// --- AC2: pending reviews are never submitted (body-only POST) ---

test('AC2: stagePendingReview issues a POST whose body contains ONLY body (no event/state/decision)', async () => {
  let captured = null
  const restore = stubFetch(async (url, opts) => {
    captured = { url, opts }
    return jsonResponse({ id: 999, state: 'PENDING' })
  })
  try {
    const result = await stagePendingReview({
      baseUrl: 'https://api.github.com',
      token: 't',
      owner: 'octo-org',
      repo: 'web-frontend',
      number: 482,
      body: 'Review findings here',
      toolName: 'test'
    })

    assert.equal(result.staged, true)
    assert.equal(result.reviewId, 999)

    assert.ok(captured, 'fetch was called')
    assert.equal(captured.opts.method, 'POST')
    assert.match(captured.url, /\/repos\/octo-org\/web-frontend\/pulls\/482\/reviews$/)

    const sentBody = JSON.parse(captured.opts.body)
    // The critical safety invariant: body-only. No submit/approve/changes keys.
    assert.deepEqual(Object.keys(sentBody).sort(), ['body'])
    assert.equal(sentBody.body, 'Review findings here')
    assert.equal(sentBody.event, undefined, 'no event -> stays PENDING')
    assert.equal(sentBody.state, undefined)
    assert.equal(sentBody.comments, undefined)
  } finally {
    restore()
  }
})

// --- AC3: safe fallback — staging failure preserves the local artifact ---

test('AC3: stage-review-if-enabled preserves artifactPath and surfaces error when staging fails, no throw', () => {
  // enabled + allowlisted so it attempts to stage; token invalid path forces failure.
  // We force failure by pointing at corp with no base URL configured OR by a bad token.
  // Simplest deterministic failure: enabled staging but GITHUB_COM_TOKEN unset.
  const input = {
    pr: { instance: 'github.com', owner: 'octo-org', repo: 'web-frontend', number: 482, url: 'https://github.com/octo-org/web-frontend/pull/482' },
    reviewBody: 'Findings...',
    artifactPath: 'output/github-reviews/2026-07-01-github.com-octo-org-web-frontend-482.md'
  }
  const { res, envelope } = runScript(input, [], { GITHUB_COM_TOKEN: '', GITHUB_STAGING_TEST_CONFIG: JSON.stringify({
    github_com: { pending_review_staging: { enabled: true, repos: ['web-frontend'] } }
  }) })

  assert.equal(res.status, 0, 'script does not crash')
  assert.ok(envelope, 'emitted a JSON envelope')
  assert.equal(envelope.ok, false)
  assert.equal(envelope.data.artifactPath, input.artifactPath, 'local artifact preserved/surfaced')
  assert.ok(envelope.errors.length > 0, 'error surfaced')
})

// --- default / not-enabled path ---

test('default: not-enabled emits local-artifact-only envelope, no fetch', () => {
  const input = {
    pr: { instance: 'github.com', owner: 'octo-org', repo: 'web-frontend', number: 482, url: 'https://github.com/octo-org/web-frontend/pull/482' },
    reviewBody: 'Findings...',
    artifactPath: 'output/github-reviews/2026-07-01-github.com-octo-org-web-frontend-482.md'
  }
  const { res, envelope } = runScript(input, [], { GITHUB_STAGING_TEST_CONFIG: JSON.stringify({
    github_com: { pending_review_staging: { enabled: false, repos: [] } }
  }) })

  assert.equal(res.status, 0)
  assert.ok(envelope)
  assert.equal(envelope.ok, true)
  assert.equal(envelope.data.staged, false)
  assert.equal(envelope.data.artifactPath, input.artifactPath)
  assert.match(envelope.data.reason || '', /disabled|opt-in|not enabled|allowlist/i)
})

// --- --dry-run: no fetch, reports intended target ---

test('--dry-run performs no API call and reports the intended target', () => {
  const input = {
    pr: { instance: 'github.com', owner: 'octo-org', repo: 'web-frontend', number: 482, url: 'https://github.com/octo-org/web-frontend/pull/482' },
    reviewBody: 'Findings body here',
    artifactPath: 'output/github-reviews/2026-07-01-github.com-octo-org-web-frontend-482.md'
  }
  const { res, envelope } = runScript(input, ['--dry-run'], { GITHUB_STAGING_TEST_CONFIG: JSON.stringify({
    github_com: { pending_review_staging: { enabled: true, repos: ['web-frontend'] } }
  }) })

  assert.equal(res.status, 0)
  assert.ok(envelope)
  assert.equal(envelope.data.dryRun, true)
  assert.equal(envelope.data.wouldStage, true)
  assert.equal(envelope.data.owner, 'octo-org')
  assert.equal(envelope.data.repo, 'web-frontend')
  assert.equal(envelope.data.number, 482)
  assert.equal(envelope.data.bodyLength, 'Findings body here'.length)
  assert.equal(envelope.data.artifactPath, input.artifactPath)
})
