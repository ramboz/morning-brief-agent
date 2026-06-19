import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { buildAiRadarSection } from '../scripts/lib/brief/ai-radar.js'
import { writeDailyBriefFiles } from '../scripts/lib/brief/output.js'
import { renderDailyBrief } from '../scripts/lib/brief/render.js'

test('renderDailyBrief composes actions, source sections, and source results', () => {
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
        markdown: ''
      },
      {
        id: 'jira',
        title: 'JIRA',
        status: 'empty',
        included: false,
        markdown: ''
      }
    ]
  })

  assert.match(markdown, /^# Daily Brief - 2026-06-18/)
  assert.match(markdown, /## What Should I Do\?/)
  assert.match(markdown, /- \*\*AI Radar:\*\* Skim the Claude skills docs/)
  assert.match(markdown, /## Source Sections/)
  assert.match(markdown, /### AI Radar\n\nUseful signal\./)
  assert.doesNotMatch(markdown, /## Slack/)
  assert.match(markdown, /- AI Radar: included/)
  assert.match(markdown, /- Slack: failed - SLACK_TOKEN is missing/)
  assert.match(markdown, /- JIRA: empty/)
})

test('renderDailyBrief gives a quiet action when no source actions are present', () => {
  const markdown = renderDailyBrief({
    date: '2026-06-18',
    sections: [
      {
        id: 'ai_radar',
        title: 'AI Radar',
        status: 'empty',
        included: false,
        markdown: ''
      }
    ]
  })

  assert.match(markdown, /- No source actions today\./)
  assert.match(markdown, /_No source sections produced content\._/)
})

test('buildAiRadarSection adapts fixture output into an included source section', async () => {
  const payload = JSON.parse(await readFile('tests/fixtures/ai-radar.json', 'utf8'))
  const section = buildAiRadarSection(payload)

  assert.equal(section.id, 'ai_radar')
  assert.equal(section.title, 'AI Radar')
  assert.equal(section.status, 'included')
  assert.equal(section.included, true)
  assert.equal(section.actions.length, 1)
  assert.match(section.markdown, /^## 🤖 AI Radar/)
  assert.equal(section.outputPaths.markdown, 'output/ai-radar/2026-06-18.md')
})

test('writeDailyBriefFiles writes dated and latest Markdown files', async () => {
  const outputDir = await mkdtemp(join(tmpdir(), 'brief-output-'))

  try {
    const paths = await writeDailyBriefFiles({
      outputDir,
      date: '2026-06-18',
      markdown: '# Daily Brief - 2026-06-18'
    })

    assert.equal(await readFile(paths.markdown, 'utf8'), '# Daily Brief - 2026-06-18\n')
    assert.equal(await readFile(paths.latest_markdown, 'utf8'), '# Daily Brief - 2026-06-18\n')
  } finally {
    await rm(outputDir, { recursive: true, force: true })
  }
})
