import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const DEFAULT_STATE_PATH = join(process.cwd(), 'logs', 'brief-state.json')

export async function loadBriefState(statePath = DEFAULT_STATE_PATH) {
  try {
    const raw = await readFile(statePath, 'utf-8')
    const parsed = JSON.parse(raw)
    return {
      statePath,
      sources: parsed.sources ?? {}
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('[brief]', `Could not read brief state, starting fresh: ${error.message}`)
    }

    return {
      statePath,
      sources: {}
    }
  }
}

export function nextSourceState(previous, section, now = new Date()) {
  const timestamp = now.toISOString()
  const succeeded = section.status !== 'failed'

  return {
    lastRunAt: timestamp,
    lastStatus: section.status,
    lastSuccessAt: succeeded ? timestamp : (previous?.lastSuccessAt ?? null),
    consecutiveFailures: succeeded ? 0 : (previous?.consecutiveFailures ?? 0) + 1,
    lastError: succeeded ? null : (section.errors?.[0] ?? previous?.lastError ?? null)
  }
}

export async function updateBriefState(state, sections, now = new Date()) {
  const nextSources = {
    ...state.sources
  }

  for (const section of sections) {
    if (!section?.id) {
      continue
    }

    nextSources[section.id] = nextSourceState(state.sources[section.id], section, now)
  }

  const nextState = {
    statePath: state.statePath,
    sources: nextSources
  }

  try {
    await mkdir(dirname(state.statePath), { recursive: true })
    await writeFile(state.statePath, JSON.stringify({ sources: nextSources }, null, 2))
  } catch (error) {
    console.error('[brief]', `Could not persist brief state: ${error.message}`)
  }

  return nextState
}
