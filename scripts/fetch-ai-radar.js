#!/usr/bin/env node

/**
 * fetch-ai-radar.js — Curated AI Radar fetch + triage + Markdown digest → JSON
 *
 * Fetches curated AI/agent content from a small RSS/Atom/GitHub source list,
 * runs a Claude-powered relevance triage pass with fallback heuristics, and
 * outputs structured JSON plus an Obsidian-ready Markdown digest.
 *
 * Modes:
 *   --brief              Nightly fetch + triage (default)
 *
 * Standalone: node scripts/fetch-ai-radar.js --brief
 * Reference:  specs/09-ai-radar.md
 *
 * Dependencies: rss-parser, cheerio, dotenv
 */

import dotenv from 'dotenv'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fetchAiRadarItems } from './lib/ai-radar/fetch.js'
import { renderAiRadarDigest } from './lib/ai-radar/render.js'
import { loadSeenCache, dedupeItems, updateSeenCache, loadHtmlWatchState, updateHtmlWatchState } from './lib/ai-radar/state.js'
import { triageAiRadarItems } from './lib/ai-radar/triage.js'
import { parseArgs, envelope, loadConfig } from './lib/config.js'

dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), '.env') })

const TOOL = 'ai_radar'

async function main() {
  const { mode, lookbackHours } = parseArgs()
  const saveFixture = process.argv.includes('--save-fixture') || process.env.SAVE_FIXTURE === '1'
  const noDedupe = process.argv.includes('--no-dedupe') || saveFixture
  const fatalErrors = []
  const now = new Date()

  let config
  try {
    config = await loadConfig('ai-radar')
  } catch (err) {
    emitAndExit(envelope(TOOL, mode, null, [err.message]))
    return
  }

  if (!config.enabled) {
    emitAndExit(envelope(TOOL, mode, null))
    return
  }

  const effectiveLookbackHours = lookbackHours || ((config.lookback_days ?? 7) * 24)
  const htmlWatchState = saveFixture ? { pages: {} } : await loadHtmlWatchState()
  const fetched = await fetchAiRadarItems(config, {
    now,
    lookbackHours: effectiveLookbackHours,
    htmlWatchState
  })
  const cache = noDedupe ? { seen: {} } : await loadSeenCache()
  const { deduped, removedCount } = noDedupe
    ? { deduped: fetched.items, removedCount: 0 }
    : dedupeItems(
        fetched.items,
        cache,
        config.dedup_window_days ?? 7,
        now
      )
  const triaged = await triageAiRadarItems(deduped, config, { now })
  const stats = {
    ...fetched.stats,
    dedupedCount: deduped.length,
    dedupedRemoved: removedCount,
    itemsAfterTriage: triaged.items.length
  }
  const render = renderAiRadarDigest(triaged.items, config, stats, { now })

  if (!noDedupe) {
    await updateSeenCache(cache, triaged.items, config.dedup_window_days ?? 7, now)
  }

  if (!saveFixture) {
    await updateHtmlWatchState(htmlWatchState, fetched.htmlWatchUpdates)
  }

  const warnings = [...fetched.errors, ...(fetched.warnings ?? []), ...triaged.errors]

  const result = {
    stats,
    triage_mode: triaged.mode,
    warnings,
    output_paths: await writeOutputFiles(render.markdown, resultDay(now)),
    // raw_items = deduped, normalized items for the running agent to triage on
    // the user's Claude subscription (see skills/morning-ai-radar/SKILL.md).
    // items/markdown below are the heuristic-only fallback for standalone runs.
    raw_items: deduped.map(projectRawItem),
    items: render.grouped,
    actions: render.actions,
    markdown: render.markdown
  }

  if (saveFixture) {
    const fixtureResult = normalizeFixtureResult(result, {
      rootDir: process.cwd(),
      fixtureDay: resultDay(now)
    })
    const fixtureDir = join(process.cwd(), 'tests', 'fixtures')
    await mkdir(fixtureDir, { recursive: true })
    await writeFile(join(fixtureDir, 'ai-radar.json'), JSON.stringify(fixtureResult, null, 2))
    await writeFile(join(fixtureDir, 'ai-radar.md'), `${fixtureResult.markdown}\n`)
  }

  emitAndExit(envelope(TOOL, mode, result, fatalErrors))
}

main().catch(err => {
  console.error(`[${TOOL}]`, err.message)
  emitAndExit(envelope(TOOL, 'brief', null, [err.message]))
})

async function writeOutputFiles(markdown, day) {
  const outputDir = join(process.cwd(), 'output', 'ai-radar')
  await mkdir(outputDir, { recursive: true })

  const datedMd = join(outputDir, `${day}.md`)
  const latestMd = join(outputDir, 'latest.md')
  const datedJson = join(outputDir, `${day}.json`)
  const latestJson = join(outputDir, 'latest.json')

  await writeFile(datedMd, `${markdown}\n`)
  await writeFile(latestMd, `${markdown}\n`)
  await writeFile(datedJson, JSON.stringify({ markdown }, null, 2))
  await writeFile(latestJson, JSON.stringify({ markdown }, null, 2))

  return {
    markdown: datedMd,
    latest_markdown: latestMd,
    json: datedJson,
    latest_json: latestJson
  }
}

function resultDay(now) {
  return now.toISOString().slice(0, 10)
}

/**
 * Project a fetched/deduped item down to the fields the agent needs to triage.
 * Keeps the JSON payload small and stable for the morning-ai-radar skill.
 */
function projectRawItem(item) {
  return {
    id: item.id,
    title: item.title,
    summary: item.summary,
    url: item.url,
    category: item.category,
    sourceType: item.sourceType,
    sourceLabel: item.sourceLabel,
    changeType: item.change_type ?? null,
    publishedAt: item.publishedAt ?? null
  }
}

function normalizeFixtureResult(result, { rootDir, fixtureDay }) {
  const normalized = JSON.parse(JSON.stringify(result))

  normalized.output_paths = Object.fromEntries(
    Object.entries(normalized.output_paths ?? {}).map(([key, value]) => [
      key,
      normalizeFixturePath(value, rootDir)
    ])
  )

  for (const items of Object.values(normalized.items ?? {})) {
    for (const item of items) {
      if (item.sourceType === 'html_page' && item.change_type === 'first_seen') {
        item.publishedAt = `${fixtureDay}T00:00:00.000Z`
      }
    }
  }

  normalized.markdown = normalized.markdown.replace(
    /Last run: \d{2}:\d{2}/,
    'Last run: 00:00'
  )

  return normalized
}

function normalizeFixturePath(value, rootDir) {
  const relativePath = relative(rootDir, value)

  if (relativePath.startsWith('..')) {
    return value
  }

  return relativePath
}

function emitAndExit(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`, () => {
    process.exit(0)
  })
}
