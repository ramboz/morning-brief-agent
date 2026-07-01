import test from 'node:test'
import assert from 'node:assert/strict'
import { fetchCiFailures } from '../scripts/lib/github.js'

/**
 * Stub globalThis.fetch with a canned check-runs response. Returns a restore fn.
 * fetchCiFailures reaches the network via githubGet -> global fetch, so this
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

test('fetchCiFailures returns failing status and failed check names', async () => {
  const restore = stubFetch(async (url) => {
    assert.match(url, /\/repos\/octo-org\/web-frontend\/commits\/abc123\/check-runs/)
    return jsonResponse({
      check_runs: [
        { name: 'unit-tests', conclusion: 'failure' },
        { name: 'build', conclusion: 'success' },
        { name: 'lint', conclusion: 'cancelled' }
      ]
    })
  })
  try {
    const ci = await fetchCiFailures('https://api.github.com', 't', 'octo-org', 'web-frontend', 'abc123', 'test')
    assert.equal(ci.ciStatus, 'failing')
    assert.deepEqual(ci.ciFailures.map(c => c.name).sort(), ['lint', 'unit-tests'])
  } finally {
    restore()
  }
})

test('fetchCiFailures returns passing when checks exist but none fail', async () => {
  const restore = stubFetch(async () =>
    jsonResponse({ check_runs: [{ name: 'unit-tests', conclusion: 'success' }] }))
  try {
    const ci = await fetchCiFailures('https://api.github.com', 't', 'o', 'r', 'sha', 'test')
    assert.equal(ci.ciStatus, 'passing')
    assert.deepEqual(ci.ciFailures, [])
  } finally {
    restore()
  }
})

test('fetchCiFailures is fault-tolerant: a fetch error yields empty CI, no throw', async () => {
  const restore = stubFetch(async () => jsonResponse({}, { ok: false, status: 404 }))
  try {
    let ci
    await assert.doesNotReject(async () => {
      ci = await fetchCiFailures('https://api.github.com', 't', 'o', 'r', 'sha', 'test')
    })
    assert.equal(ci.ciStatus, null)
    assert.deepEqual(ci.ciFailures, [])
  } finally {
    restore()
  }
})

test('fetchCiFailures returns empty CI when sha is absent (no fetch)', async () => {
  let called = false
  const restore = stubFetch(async () => { called = true; return jsonResponse({}) })
  try {
    const ci = await fetchCiFailures('https://api.github.com', 't', 'o', 'r', null, 'test')
    assert.equal(ci.ciStatus, null)
    assert.deepEqual(ci.ciFailures, [])
    assert.equal(called, false, 'no fetch made when sha is missing')
  } finally {
    restore()
  }
})
