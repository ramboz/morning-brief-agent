import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const DEFAULT_CACHE_PATH = join(process.cwd(), 'logs', 'ai-radar-seen.json')
const DEFAULT_HTML_WATCH_PATH = join(process.cwd(), 'logs', 'ai-radar-html-watch.json')

export async function loadSeenCache(cachePath = DEFAULT_CACHE_PATH) {
  try {
    const raw = await readFile(cachePath, 'utf-8')
    const parsed = JSON.parse(raw)
    return {
      cachePath,
      seen: parsed.seen ?? {}
    }
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {
        cachePath,
        seen: {}
      }
    }

    throw new Error(`Could not read seen cache: ${error.message}`)
  }
}

export function dedupeItems(items, cache, dedupWindowDays, now = new Date()) {
  const cutoff = now.getTime() - dedupWindowDays * 24 * 60 * 60 * 1000
  const today = formatDay(now)

  const deduped = items.filter(item => {
    const seenAt = cache.seen[item.url]

    if (!seenAt) {
      return true
    }

    if (formatDay(new Date(seenAt)) === today) {
      return true
    }

    return new Date(seenAt).getTime() < cutoff
  })

  return {
    deduped,
    removedCount: items.length - deduped.length
  }
}

export async function updateSeenCache(cache, items, dedupWindowDays, now = new Date()) {
  const cutoff = now.getTime() - dedupWindowDays * 24 * 60 * 60 * 1000
  const nextSeen = {}

  for (const [url, seenAt] of Object.entries(cache.seen)) {
    if (new Date(seenAt).getTime() >= cutoff) {
      nextSeen[url] = seenAt
    }
  }

  for (const item of items) {
    if (item.url) {
      nextSeen[item.url] = now.toISOString()
    }
  }

  await mkdir(dirname(cache.cachePath), { recursive: true })
  await writeFile(cache.cachePath, JSON.stringify({ seen: nextSeen }, null, 2))
}

export async function loadHtmlWatchState(statePath = DEFAULT_HTML_WATCH_PATH) {
  try {
    const raw = await readFile(statePath, 'utf-8')
    const parsed = JSON.parse(raw)
    return {
      statePath,
      pages: parsed.pages ?? {}
    }
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {
        statePath,
        pages: {}
      }
    }

    throw new Error(`Could not read HTML watch state: ${error.message}`)
  }
}

export async function updateHtmlWatchState(state, updates) {
  const nextPages = {
    ...state.pages
  }

  for (const update of updates) {
    if (!update?.key) {
      continue
    }

    nextPages[update.key] = {
      ...nextPages[update.key],
      ...update
    }
  }

  await mkdir(dirname(state.statePath), { recursive: true })
  await writeFile(state.statePath, JSON.stringify({ pages: nextPages }, null, 2))
}

function formatDay(date) {
  return date.toISOString().slice(0, 10)
}
