import { readFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export async function collectAiRadarSection({ fixturePath = null } = {}) {
  if (fixturePath) {
    const payload = JSON.parse(await readFile(fixturePath, 'utf8'))
    return buildAiRadarSection(payload)
  }

  try {
    const { stdout } = await execFileAsync('node', ['scripts/fetch-ai-radar.js', '--brief'], {
      maxBuffer: 1024 * 1024 * 10
    })
    return buildAiRadarSection(JSON.parse(stdout))
  } catch (err) {
    return {
      id: 'ai_radar',
      title: 'AI Radar',
      status: 'failed',
      included: false,
      actions: [],
      markdown: '',
      warnings: [],
      errors: [err.message],
      outputPaths: {}
    }
  }
}

export function buildAiRadarSection(payload) {
  const errors = [...(payload.errors ?? [])]
  const data = payload.tool === 'ai_radar' ? payload.data : payload

  if (payload.tool === 'ai_radar' && payload.ok === false) {
    return emptyAiRadarSection('failed', errors)
  }

  if (!data) {
    return emptyAiRadarSection('empty', errors)
  }

  const markdown = data.markdown ?? ''
  const included = markdown.trim().length > 0

  return {
    id: 'ai_radar',
    title: 'AI Radar',
    status: included ? 'included' : 'empty',
    included,
    actions: data.actions ?? [],
    markdown,
    warnings: data.warnings ?? [],
    errors,
    outputPaths: data.output_paths ?? {}
  }
}

function emptyAiRadarSection(status, errors = []) {
  return {
    id: 'ai_radar',
    title: 'AI Radar',
    status,
    included: false,
    actions: [],
    markdown: '',
    warnings: [],
    errors,
    outputPaths: {}
  }
}
