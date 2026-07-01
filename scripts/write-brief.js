#!/usr/bin/env node

/**
 * write-brief.js - Manual Daily Brief writer.
 *
 * Composes available source sections into one Obsidian-ready Markdown note.
 * Starts with AI Radar and keeps the shell source-agnostic for later slices.
 */

import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { collectAiRadarSection } from './lib/brief/ai-radar.js'
import { writeDailyBriefFiles } from './lib/brief/output.js'
import { renderDailyBrief } from './lib/brief/render.js'
import { loadBriefState, updateBriefState } from './lib/brief/state.js'
import { envelope } from './lib/config.js'

const TOOL = 'brief'
const DEFAULT_SOURCES = ['ai_radar']

async function main() {
  let args
  try {
    args = parseBriefArgs(process.argv.slice(2))
  } catch (err) {
    emitAndExit(envelope(TOOL, 'brief', null, [err.message]))
    return
  }

  const now = new Date()
  let mainConfig = {}
  try {
    mainConfig = await loadOptionalMainConfig()
  } catch (err) {
    emitAndExit(envelope(TOOL, 'brief', null, [err.message]))
    return
  }

  const date = args.date ?? formatDate(now, mainConfig.date_format ?? 'YYYY-MM-DD')
  const sources = args.sources ?? normalizeSourceList(mainConfig.daily_brief?.sources ?? DEFAULT_SOURCES)
  const outputDir = resolveOutputDir({
    cliOutputDir: args.outputDir,
    envOutputDir: process.env.DAILY_BRIEF_OUTPUT_DIR,
    mainConfig
  })

  const priorState = await loadBriefState(args.statePath ?? undefined)

  const sections = await collectSections(sources, {
    aiRadarFixture: args.aiRadarFixture
  })
  annotateSectionsWithHistory(sections, priorState)

  const markdown = renderDailyBrief({ date, generatedAt: now, sections })
  const outputPaths = await writeDailyBriefFiles({ outputDir, date, markdown })
  await updateBriefState(priorState, sections, now)

  emitAndExit(envelope(TOOL, 'brief', {
    date,
    output_paths: outputPaths,
    sources: sections.map(summarizeSource),
    markdown
  }))
}

main().catch(err => {
  console.error(`[${TOOL}]`, err.message)
  emitAndExit(envelope(TOOL, 'brief', null, [err.message]))
})

async function collectSections(sources, options) {
  const sections = []

  for (const source of sources) {
    if (source === 'ai_radar') {
      sections.push(await collectAiRadarSection({ fixturePath: options.aiRadarFixture }))
    } else {
      sections.push({
        id: source,
        title: source,
        status: 'failed',
        included: false,
        actions: [],
        markdown: '',
        warnings: [],
        errors: [`Unsupported source: ${source}`],
        outputPaths: {}
      })
    }
  }

  return sections
}

function annotateSectionsWithHistory(sections, priorState) {
  for (const section of sections) {
    const previous = priorState.sources[section.id]
    if (section.status === 'failed' && previous && (previous.lastSuccessAt || previous.consecutiveFailures > 0)) {
      section.history = {
        lastSuccessAt: previous.lastSuccessAt,
        consecutiveFailures: previous.consecutiveFailures
      }
    }
  }
}

function parseBriefArgs(argv) {
  const args = {
    date: null,
    outputDir: null,
    aiRadarFixture: null,
    sources: null,
    statePath: null
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--brief') {
      continue
    }

    if (arg === '--date') {
      args.date = requiredValue(argv, i, arg)
      i += 1
      continue
    }

    if (arg === '--output-dir') {
      args.outputDir = requiredValue(argv, i, arg)
      i += 1
      continue
    }

    if (arg === '--ai-radar-fixture') {
      args.aiRadarFixture = requiredValue(argv, i, arg)
      i += 1
      continue
    }

    if (arg === '--sources') {
      args.sources = normalizeSourceList(requiredValue(argv, i, arg).split(','))
      i += 1
      continue
    }

    if (arg === '--state-path') {
      args.statePath = requiredValue(argv, i, arg)
      i += 1
      continue
    }

    throw new Error(`Unknown option: ${arg}`)
  }

  if (args.date && !/^\d{4}-\d{2}-\d{2}$/.test(args.date)) {
    throw new Error('--date must use YYYY-MM-DD')
  }

  return args
}

function requiredValue(argv, index, flag) {
  const value = argv[index + 1]
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`)
  }
  return value
}

function normalizeSourceName(value) {
  return value.replaceAll('-', '_')
}

function normalizeSourceList(values) {
  return values
    .map(value => normalizeSourceName(String(value).trim()))
    .filter(Boolean)
}

async function loadOptionalMainConfig() {
  const configPath = join(process.cwd(), 'config', 'main.json')
  try {
    return JSON.parse(await readFile(configPath, 'utf8'))
  } catch (err) {
    if (err.code === 'ENOENT') {
      return {}
    }
    throw new Error(`Config invalid: ${configPath} - ${err.message}`)
  }
}

function resolveOutputDir({ cliOutputDir, envOutputDir, mainConfig }) {
  if (cliOutputDir) {
    return resolve(cliOutputDir)
  }

  if (envOutputDir) {
    return resolve(envOutputDir)
  }

  if (mainConfig.daily_brief?.output_dir) {
    return resolve(mainConfig.daily_brief.output_dir)
  }

  if (isUsableVaultPath(mainConfig.vault_path)) {
    return resolve(join(
      mainConfig.vault_path,
      mainConfig.daily_notes_folder ?? 'Daily Notes'
    ))
  }

  return resolve('output', 'daily')
}

function isUsableVaultPath(value) {
  return typeof value === 'string' && value.length > 0 && !value.startsWith('/path/to/')
}

function formatDate(date, pattern) {
  const year = String(date.getFullYear())
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return pattern
    .replaceAll('YYYY', year)
    .replaceAll('MM', month)
    .replaceAll('DD', day)
}

function summarizeSource(section) {
  return {
    id: section.id,
    title: section.title,
    status: section.status,
    included: section.included,
    actions_count: section.actions?.length ?? 0,
    warnings: section.warnings ?? [],
    errors: section.errors ?? [],
    output_paths: section.outputPaths ?? {}
  }
}

function emitAndExit(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`, () => {
    process.exit(0)
  })
}
