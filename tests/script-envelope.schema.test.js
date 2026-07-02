import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { envelope } from '../scripts/lib/config.js'

// Validates the committed script-envelope contract
// (docs/contracts/script-envelope.schema.json) against:
//   1. the real envelope() producer in scripts/lib/config.js,
//   2. the canonical example fixture, and
//   3. the AI Radar fixture wrapped exactly as fetch-ai-radar.js emits it.
// This is the "validation command" documented in docs/contracts/README.md
// and docs/architecture.md § Contract surfaces: `npm test`.

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..')

const schema = JSON.parse(
  await readFile(join(repoRoot, 'docs/contracts/script-envelope.schema.json'), 'utf8')
)

// `data` is intentionally a union (object | array | null), so allowUnionTypes.
const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true })
addFormats(ajv)
const validate = ajv.compile(schema)

test('script-envelope schema compiles under ajv strict mode', () => {
  assert.equal(typeof validate, 'function')
})

test('envelope() success output conforms to the contract', () => {
  const env = envelope('jira', 'brief', { tickets: [] }, [])
  assert.ok(validate(env), ajv.errorsText(validate.errors))
  assert.equal(env.ok, true)
})

test('envelope() error output conforms to the contract', () => {
  const env = envelope('jira', 'brief', null, ['JIRA_BASE_URL not set'])
  assert.ok(validate(env), ajv.errorsText(validate.errors))
  assert.equal(env.ok, false)
})

test('canonical example fixture conforms to the contract', async () => {
  const example = JSON.parse(
    await readFile(join(repoRoot, 'tests/fixtures/script-envelope.example.json'), 'utf8')
  )
  assert.ok(validate(example), ajv.errorsText(validate.errors))
})

test('AI Radar fixture, wrapped as the script emits it, conforms to the contract', async () => {
  // fetch-ai-radar.js emits envelope(TOOL, mode, result, errors). The on-disk
  // ai-radar.json fixture is fetch-ai-radar.js's normalized `result` payload
  // (its normalizeFixtureResult stabilizes timestamps for deterministic diffs);
  // it is structurally equivalent to `data` at the envelope level.
  const data = JSON.parse(
    await readFile(join(repoRoot, 'tests/fixtures/ai-radar.json'), 'utf8')
  )
  const env = envelope('ai-radar', 'brief', data, [])
  assert.ok(validate(env), ajv.errorsText(validate.errors))
})

test('envelope() operational modes conform to the contract', () => {
  // Scripts emit more than brief/search. This is the full set of mode labels
  // passed to envelope() across scripts/ today; the contract must accept them.
  for (const mode of ['search', 'context', 'draft', 'index', 'cleanup', 'discard', 'list', 'stage', 'write', 'unknown']) {
    const env = envelope('github', mode, { staged: false }, [])
    assert.ok(validate(env), `mode=${mode}: ${ajv.errorsText(validate.errors)}`)
  }
})

test('rejects an envelope missing any single required field', () => {
  const complete = {
    ok: true, tool: 'jira', mode: 'brief', timestamp: '2026-07-02T08:00:00.000Z',
    data: null, errors: []
  }
  for (const field of ['ok', 'tool', 'mode', 'timestamp', 'data', 'errors']) {
    const bad = { ...complete }
    delete bad[field]
    assert.equal(validate(bad), false, `omitting ${field} should fail validation`)
  }
})

test('rejects an unknown top-level property (additionalProperties: false)', () => {
  const bad = {
    ok: true, tool: 'jira', mode: 'brief', timestamp: '2026-07-02T08:00:00.000Z',
    data: null, errors: [], extra: 'nope'
  }
  assert.equal(validate(bad), false)
})

test('rejects an empty mode string', () => {
  const bad = {
    ok: true, tool: 'jira', mode: '', timestamp: '2026-07-02T08:00:00.000Z',
    data: null, errors: []
  }
  assert.equal(validate(bad), false)
})

test('rejects a non-string error item', () => {
  const bad = {
    ok: false, tool: 'jira', mode: 'brief', timestamp: '2026-07-02T08:00:00.000Z',
    data: null, errors: [{ message: 'not a string' }]
  }
  assert.equal(validate(bad), false)
})
