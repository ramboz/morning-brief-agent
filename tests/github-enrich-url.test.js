import test from 'node:test'
import assert from 'node:assert/strict'
import { enrichNotification } from '../scripts/lib/github.js'

/**
 * Stub globalThis.fetch, capturing every requested URL. Returns { restore, urls }.
 * enrichNotification reaches the network via githubGet -> global fetch, so this
 * exercises the helper end-to-end without any real request.
 */
function stubFetch(handler) {
  const original = globalThis.fetch
  const urls = []
  globalThis.fetch = async (url, opts) => {
    urls.push(String(url))
    return handler(url, opts)
  }
  return { restore: () => { globalThis.fetch = original }, urls }
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

const PR_SUBJECT = {
  html_url: 'https://git.corp.adobe.com/experience-platform/mystique/pull/3273',
  user: { login: 'someauthor' },
  state: 'open',
  merged: false,
  draft: false,
  body: 'Fixes the event loop wedge.'
}

function corpNotification() {
  return {
    id: '9619040',
    reason: 'author',
    repository: { full_name: 'experience-platform/mystique' },
    updated_at: '2026-07-09T04:14:25Z',
    subject: {
      title: 'fix(cwv): stop force-recompute',
      type: 'PullRequest',
      // GitHub Enterprise returns an absolute API URL that already includes /api/v3
      url: 'https://git.corp.adobe.com/api/v3/repos/experience-platform/mystique/pulls/3273'
    }
  }
}

test('enrichNotification (corp): does not double the /api/v3 prefix', async () => {
  const baseUrl = 'https://git.corp.adobe.com/api/v3'
  const { restore, urls } = stubFetch(async () => jsonResponse(PR_SUBJECT))
  try {
    const result = await enrichNotification(baseUrl, 't', corpNotification(), false, 'test')
    assert.equal(urls.length, 1, 'exactly one enrichment fetch')
    assert.doesNotMatch(urls[0], /\/api\/v3\/api\/v3\//, 'must not double /api/v3')
    assert.equal(urls[0], 'https://git.corp.adobe.com/api/v3/repos/experience-platform/mystique/pulls/3273')
    // Enrichment must populate the fields that were coming back null
    assert.equal(result.url, PR_SUBJECT.html_url)
    assert.equal(result.state, 'open')
    assert.equal(result.author, 'someauthor')
  } finally {
    restore()
  }
})

test('enrichNotification (github.com): unchanged, no /api/v3 involved', async () => {
  const baseUrl = 'https://api.github.com'
  const notification = {
    id: '1',
    reason: 'mention',
    repository: { full_name: 'octo-org/web-frontend' },
    updated_at: '2026-07-09T04:14:25Z',
    subject: {
      title: 'Add retry logic',
      type: 'PullRequest',
      url: 'https://api.github.com/repos/octo-org/web-frontend/pulls/42'
    }
  }
  const comSubject = { ...PR_SUBJECT, html_url: 'https://github.com/octo-org/web-frontend/pull/42' }
  const { restore, urls } = stubFetch(async () => jsonResponse(comSubject))
  try {
    const result = await enrichNotification(baseUrl, 't', notification, false, 'test')
    assert.equal(urls[0], 'https://api.github.com/repos/octo-org/web-frontend/pulls/42')
    assert.equal(result.url, 'https://github.com/octo-org/web-frontend/pull/42')
    assert.equal(result.author, 'someauthor')
  } finally {
    restore()
  }
})
