import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { loadBriefState, updateBriefState, nextSourceState } from '../scripts/lib/brief/state.js'
import { renderDailyBrief } from '../scripts/lib/brief/render.js'

const execFileAsync = promisify(execFile)

test('loadBriefState returns an empty default when the state file is missing', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'brief-state-'))
  try {
    const statePath = join(dir, 'does-not-exist.json')
    const state = await loadBriefState(statePath)

    assert.equal(state.statePath, statePath)
    assert.deepEqual(state.sources, {})
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('updateBriefState writes state that loadBriefState can read back (round-trip)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'brief-state-'))
  try {
    const statePath = join(dir, 'brief-state.json')
    const state = await loadBriefState(statePath)

    const now = new Date('2026-06-18T08:00:00.000Z')
    const updated = await updateBriefState(state, [
      { id: 'ai_radar', status: 'included' },
      { id: 'slack', status: 'failed', errors: ['SLACK_TOKEN is missing'] }
    ], now)

    assert.equal(updated.sources.ai_radar.lastStatus, 'included')
    assert.equal(updated.sources.ai_radar.lastRunAt, now.toISOString())
    assert.equal(updated.sources.ai_radar.lastSuccessAt, now.toISOString())
    assert.equal(updated.sources.ai_radar.consecutiveFailures, 0)
    assert.equal(updated.sources.ai_radar.lastError, null)

    assert.equal(updated.sources.slack.lastStatus, 'failed')
    assert.equal(updated.sources.slack.consecutiveFailures, 1)
    assert.equal(updated.sources.slack.lastError, 'SLACK_TOKEN is missing')
    assert.equal(updated.sources.slack.lastSuccessAt, null)

    const reloaded = await loadBriefState(statePath)
    assert.deepEqual(reloaded.sources, updated.sources)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('loadBriefState falls back to an empty state and logs a diagnostic when the file is corrupt', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'brief-state-'))
  try {
    const statePath = join(dir, 'brief-state.json')
    await writeFile(statePath, '{ not valid json')

    const originalConsoleError = console.error
    const loggedCalls = []
    console.error = (...args) => loggedCalls.push(args)

    let state
    try {
      state = await loadBriefState(statePath)
    } finally {
      console.error = originalConsoleError
    }

    assert.equal(state.statePath, statePath)
    assert.deepEqual(state.sources, {})
    assert.equal(loggedCalls.length, 1)
    assert.equal(loggedCalls[0][0], '[brief]')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('nextSourceState increments consecutive failures and preserves last success time across repeated failures', () => {
  const previous = {
    lastRunAt: '2026-06-16T08:00:00.000Z',
    lastStatus: 'failed',
    lastSuccessAt: '2026-06-15T08:00:00.000Z',
    consecutiveFailures: 2,
    lastError: 'boom'
  }

  const now = new Date('2026-06-18T08:00:00.000Z')
  const next = nextSourceState(previous, { id: 'jira', status: 'failed', errors: ['still boom'] }, now)

  assert.equal(next.lastStatus, 'failed')
  assert.equal(next.lastRunAt, now.toISOString())
  assert.equal(next.lastSuccessAt, '2026-06-15T08:00:00.000Z')
  assert.equal(next.consecutiveFailures, 3)
  assert.equal(next.lastError, 'still boom')
})

test('nextSourceState resets consecutive failures on success', () => {
  const previous = {
    lastRunAt: '2026-06-16T08:00:00.000Z',
    lastStatus: 'failed',
    lastSuccessAt: '2026-06-10T08:00:00.000Z',
    consecutiveFailures: 4,
    lastError: 'boom'
  }

  const now = new Date('2026-06-18T08:00:00.000Z')
  const next = nextSourceState(previous, { id: 'jira', status: 'included' }, now)

  assert.equal(next.lastStatus, 'included')
  assert.equal(next.lastSuccessAt, now.toISOString())
  assert.equal(next.consecutiveFailures, 0)
  assert.equal(next.lastError, null)
})

test('simulated repeated source failure does not block other sections and renders failure-streak history', () => {
  const markdown = renderDailyBrief({
    date: '2026-06-18',
    generatedAt: new Date('2026-06-18T15:30:00.000Z'),
    sections: [
      {
        id: 'ai_radar',
        title: 'AI Radar',
        status: 'included',
        included: true,
        actions: ['Skim the Claude skills docs for one reusable workflow change.'],
        markdown: '## AI Radar\n\nUseful signal.'
      },
      {
        id: 'slack',
        title: 'Slack',
        status: 'failed',
        included: false,
        errors: ['SLACK_TOKEN is missing'],
        markdown: '',
        history: {
          lastSuccessAt: '2026-06-15T08:00:00.000Z',
          consecutiveFailures: 3
        }
      }
    ]
  })

  // Other sections still render despite the simulated Slack failure.
  assert.match(markdown, /### AI Radar\n\nUseful signal\./)
  assert.match(markdown, /- \*\*AI Radar:\*\*/)

  // The failing source's footer line surfaces failure-streak history.
  assert.match(markdown, /- Slack: failed - SLACK_TOKEN is missing \(3 consecutive failures, last success 2026-06-15T08:00:00\.000Z\)/)
})

test('renderDailyBrief does not add history text for sections without history data', () => {
  const markdown = renderDailyBrief({
    date: '2026-06-18',
    sections: [
      {
        id: 'jira',
        title: 'JIRA',
        status: 'failed',
        included: false,
        errors: ['boom'],
        markdown: ''
      }
    ]
  })

  assert.match(markdown, /- JIRA: failed - boom$/m)
  assert.doesNotMatch(markdown, /consecutive failures/)
})

test('write-brief.js CLI persists per-source state across runs and surfaces repeated-failure history', async () => {
  const outputDir = await mkdtemp(join(tmpdir(), 'brief-output-'))
  const stateDir = await mkdtemp(join(tmpdir(), 'brief-state-'))
  const statePath = join(stateDir, 'brief-state.json')

  try {
    const run = () => execFileAsync(process.execPath, [
      'scripts/write-brief.js',
      '--brief',
      '--date', '2026-06-18',
      '--output-dir', outputDir,
      '--state-path', statePath,
      '--sources', 'ai_radar,broken_source',
      '--ai-radar-fixture', 'tests/fixtures/ai-radar.json'
    ])

    // First run: broken_source fails once, no prior history yet.
    const first = JSON.parse((await run()).stdout)
    assert.equal(first.ok, true)
    assert.match(first.data.markdown, /- broken_source: failed - Unsupported source: broken_source$/m)
    assert.doesNotMatch(first.data.markdown, /consecutive failures/)

    const stateAfterFirst = JSON.parse(await readFile(statePath, 'utf8'))
    assert.equal(stateAfterFirst.sources.broken_source.consecutiveFailures, 1)
    assert.equal(stateAfterFirst.sources.ai_radar.lastStatus, 'included')

    // Second run: broken_source fails again — the footer surfaces the streak
    // accumulated *before* this run (1), while the persisted state after this
    // run advances to 2 for the next run to read.
    const second = JSON.parse((await run()).stdout)
    assert.equal(second.ok, true)
    assert.match(second.data.markdown, /- AI Radar: included/)
    assert.match(second.data.markdown, /- broken_source: failed - Unsupported source: broken_source \(1 consecutive failure\)/)

    const stateAfterSecond = JSON.parse(await readFile(statePath, 'utf8'))
    assert.equal(stateAfterSecond.sources.broken_source.consecutiveFailures, 2)
  } finally {
    await rm(outputDir, { recursive: true, force: true })
    await rm(stateDir, { recursive: true, force: true })
  }
})

test('write-brief.js CLI degrades gracefully on a corrupt state file instead of failing the whole run', async () => {
  const outputDir = await mkdtemp(join(tmpdir(), 'brief-output-'))
  const stateDir = await mkdtemp(join(tmpdir(), 'brief-state-'))
  const statePath = join(stateDir, 'brief-state.json')

  try {
    await writeFile(statePath, '{ this is not valid json')

    const { stdout, stderr } = await execFileAsync(process.execPath, [
      'scripts/write-brief.js',
      '--brief',
      '--date', '2026-06-18',
      '--output-dir', outputDir,
      '--state-path', statePath,
      '--sources', 'ai_radar',
      '--ai-radar-fixture', 'tests/fixtures/ai-radar.json'
    ])

    const result = JSON.parse(stdout)
    assert.equal(result.ok, true)
    assert.equal(result.errors.length, 0)
    assert.match(result.data.markdown, /- AI Radar: included/)
    assert.match(stderr, /\[brief\]/)

    // The run should still persist fresh, valid state for the next run.
    const stateAfter = JSON.parse(await readFile(statePath, 'utf8'))
    assert.equal(stateAfter.sources.ai_radar.lastStatus, 'included')
  } finally {
    await rm(outputDir, { recursive: true, force: true })
    await rm(stateDir, { recursive: true, force: true })
  }
})
