import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  buildReviewContext,
  renderReviewArtifact,
  artifactRelPath,
  writeReviewArtifact
} from '../scripts/lib/github/review-artifact.js'

async function loadFixture(name) {
  return JSON.parse(await readFile(join('tests/fixtures', name), 'utf8'))
}

// --- AC1: review context is sufficient / records missing pieces ---

test('AC1: buildReviewContext surfaces description, changed files, comments, and failed checks', async () => {
  const raw = await loadFixture('github-pr-context.json')
  const ctx = buildReviewContext(raw)

  assert.equal(ctx.pr.owner, 'octo-org')
  assert.equal(ctx.pr.repo, 'web-frontend')
  assert.equal(ctx.pr.number, 482)
  assert.equal(ctx.pr.title, 'feat: add OAuth2 login flow')
  assert.equal(ctx.pr.author, 'alice')
  assert.match(ctx.pr.url, /\/pull\/482$/)

  assert.match(ctx.description, /OAuth2/)
  assert.ok(ctx.diff && ctx.diff.length > 0, 'diff present')
  assert.equal(ctx.changedFiles.changedFiles, 2)
  assert.equal(ctx.reviewComments.length, 1)
  assert.equal(ctx.conversationComments.length, 1)
  assert.equal(ctx.failedChecks.length, 2)
  assert.deepEqual(ctx.failedChecks.map(c => c.name).sort(), ['lint', 'unit-tests'])
  assert.equal(ctx.linkedIssues.length, 1)

  assert.deepEqual(ctx.missing, [], 'nothing missing for the full fixture')
})

test('AC1 + DoD: buildReviewContext records unfetchable pieces in missing[]', async () => {
  const raw = await loadFixture('github-pr-context-partial.json')
  const ctx = buildReviewContext(raw)

  assert.ok(ctx.missing.includes('diff'), 'diff recorded as missing')
  assert.ok(ctx.missing.includes('changed files'), 'changed files recorded as missing')
  assert.ok(ctx.missing.includes('review comments'), 'review comments recorded as missing')
  assert.ok(ctx.missing.includes('conversation comments'), 'conversation comments recorded as missing')
  assert.ok(ctx.missing.includes('failed checks'), 'failed checks recorded as missing')
  // description is present, so it must not be flagged
  assert.ok(!ctx.missing.includes('description'))
})

test('AC1: buildReviewContext lists failed checks when ciFailures is present', async () => {
  const raw = await loadFixture('github-pr-context.json')
  const ctx = buildReviewContext(raw)
  assert.ok(!ctx.missing.includes('failed checks'), 'ciFailures present -> not missing')
  assert.equal(ctx.failedChecks.length, 2)
  assert.deepEqual(ctx.failedChecks.map(c => c.name).sort(), ['lint', 'unit-tests'])
})

test('AC1: an explicit empty ciFailures array reports "none reported", not missing', () => {
  const ctx = buildReviewContext({
    body: 'x', diff: 'y', diffStat: { changedFiles: 1 },
    reviewComments: [], conversationComments: [], ciFailures: []
  })
  assert.ok(!ctx.missing.includes('failed checks'), 'empty array is fetched-but-none, not missing')
  assert.equal(ctx.failedChecks.length, 0)
  const md = renderReviewArtifact({ pr: ctx.pr, context: ctx, reviewBody: 'ok' })
  assert.match(md, /Failed checks: none reported/)
})

test('AC1: renderReviewArtifact shows "Failed checks: unavailable" when CI is missing', async () => {
  const raw = await loadFixture('github-pr-context-partial.json')
  const ctx = buildReviewContext(raw)
  const md = renderReviewArtifact({ pr: ctx.pr, context: ctx, reviewBody: 'partial' })
  assert.match(md, /Failed checks: unavailable/)
})

test('AC1: buildReviewContext is pure and tolerates null/garbage input', () => {
  assert.doesNotThrow(() => buildReviewContext(null))
  assert.doesNotThrow(() => buildReviewContext({}))
  const ctx = buildReviewContext({})
  assert.ok(Array.isArray(ctx.missing))
})

// --- AC3: render leads with findings, carries header + context section ---

test('AC3: renderReviewArtifact leads with the review body and carries all header fields', async () => {
  const raw = await loadFixture('github-pr-context.json')
  const ctx = buildReviewContext(raw)
  const reviewBody = [
    '**Verdict:** With fixes',
    '',
    '### Blockers',
    '- [Blocker] `src/auth/AuthClient.js:6` — `exchangeCode` ignores non-200 responses.',
    '',
    '### Should Fix',
    '- [Should Fix] Missing integration test for cookie flags.'
  ].join('\n')

  const md = renderReviewArtifact({
    pr: ctx.pr,
    context: ctx,
    reviewBody,
    generatedAt: new Date('2026-07-01T08:00:00.000Z')
  })

  // Findings lead: the Review heading + body appear before the context section.
  const reviewIdx = md.indexOf('## Review')
  const contextIdx = md.indexOf('## Review context')
  assert.ok(reviewIdx !== -1, 'has ## Review heading')
  assert.ok(contextIdx !== -1, 'has ## Review context heading')
  assert.ok(reviewIdx < contextIdx, 'review findings lead the context section')
  assert.match(md, /ignores non-200 responses/)

  // Header fields
  assert.match(md, /octo-org\/web-frontend/)
  assert.match(md, /#482/)
  assert.match(md, /feat: add OAuth2 login flow/)
  assert.match(md, /alice/)
  assert.match(md, /https:\/\/github\.com\/octo-org\/web-frontend\/pull\/482/)
  assert.match(md, /github\.com/)
  assert.match(md, /2026-07-01T08:00:00/)

  // Context summary
  assert.match(md, /## Review context/)
  assert.match(md, /unit-tests/)
  assert.match(md, /Changed files/i)
})

test('AC3 + DoD: renderReviewArtifact includes an explicit missing-context note when present', async () => {
  const raw = await loadFixture('github-pr-context-partial.json')
  const ctx = buildReviewContext(raw)
  const md = renderReviewArtifact({
    pr: ctx.pr,
    context: ctx,
    reviewBody: 'Insufficient context to review confidently.',
    generatedAt: new Date('2026-07-01T08:00:00.000Z')
  })

  assert.match(md, /missing/i, 'explicit missing-context note')
  assert.match(md, /diff/, 'names the missing diff')
})

// --- artifactRelPath ---

test('artifactRelPath produces the output/github-reviews path with sanitized names', () => {
  const rel = artifactRelPath(
    { instance: 'github.com', owner: 'octo-org', repo: 'web-frontend', number: 482 },
    { date: '2026-07-01' }
  )
  assert.equal(rel, 'output/github-reviews/2026-07-01-github.com-octo-org-web-frontend-482.md')
})

test('artifactRelPath sanitizes slashes in owner/repo', () => {
  const rel = artifactRelPath(
    { instance: 'corporate', owner: 'a/b', repo: 'c/d', number: 7 },
    { date: '2026-07-01' }
  )
  assert.ok(!rel.slice('output/github-reviews/'.length).includes('/'.repeat(1) + 'a'),
    'no stray slashes from owner/repo in the filename')
  assert.match(rel, /2026-07-01-corporate-a-b-c-d-7\.md$/)
})

// --- AC2: written locally, no network ---

test('AC2: writeReviewArtifact writes to output/github-reviews with expected name, no network', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'review-artifact-'))
  try {
    const pr = { instance: 'github.com', owner: 'octo-org', repo: 'web-frontend', number: 482 }
    const abs = await writeReviewArtifact({
      pr,
      markdown: '# hello\n',
      baseDir: dir,
      date: '2026-07-01'
    })

    assert.ok(abs.startsWith(dir), 'writes under the provided baseDir')
    assert.match(abs, /output\/github-reviews\/2026-07-01-github\.com-octo-org-web-frontend-482\.md$/)

    const s = await stat(abs)
    assert.ok(s.isFile(), 'artifact file exists')
    const content = await readFile(abs, 'utf8')
    assert.equal(content, '# hello\n')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
