import { promisify } from 'node:util'
import { execFile as execFileCallback } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const MODEL = process.env.AI_RADAR_CLAUDE_MODEL || 'claude-sonnet-4-20250514'
const CODEX_MODEL = process.env.AI_RADAR_CODEX_MODEL || 'gpt-5'
const VALID_LAYERS = new Set(['today_signal', 'skills_tutorials', 'strategic_radar', 'skip'])
const TUTORIAL_HINTS = ['tutorial', 'cookbook', 'guide', 'how to', 'walkthrough', 'example', 'examples', 'evaluation', 'eval', 'prompt', 'tool use', 'pattern']
const SIGNAL_HINTS = ['release', 'launch', 'launched', 'introducing', 'announcing', 'api', 'model', 'update', 'specification', 'general availability', 'now available']
const NOISE_HINTS = ['funding', 'hiring', 'webinar', 'podcast', 'conference', 'meetup', 'sponsor']
const GENERIC_MODEL_HINTS = ['sota', 'benchmarks', 'cost', 'open model', 'cheaper', 'faster']
const execFile = promisify(execFileCallback)
const CODEX_TIMEOUT_MS = 45000
const CLAUDE_TIMEOUT_MS = 15000
const TRIAGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          layer: { type: 'string', enum: ['today_signal', 'skills_tutorials', 'strategic_radar', 'skip'] },
          score: { type: 'number' },
          reason: { type: 'string' },
          build_relevance: { type: ['string', 'null'] },
          action: { type: ['string', 'null'] },
          display_title: { type: ['string', 'null'] },
          summary_override: { type: ['string', 'null'] }
        },
        required: ['id', 'layer', 'score', 'reason', 'build_relevance', 'action', 'display_title', 'summary_override']
      }
    }
  },
  required: ['items']
}

export async function triageAiRadarItems(items, config, options = {}) {
  if (items.length === 0) {
    return {
      items: [],
      mode: 'empty',
      errors: []
    }
  }

  const codexResult = await tryCodexTriage(items, config, options)
  if (codexResult.ok) {
    return {
      items: codexResult.items,
      mode: 'codex',
      errors: []
    }
  }

  const claudeResult = await tryClaudeTriage(items, config, options)
  if (claudeResult.ok) {
    return {
      items: claudeResult.items,
      mode: 'claude',
      errors: []
    }
  }

  return {
    items: heuristicTriage(items, config, options),
    mode: 'heuristic_fallback',
    errors: [codexResult.error, claudeResult.error].filter(Boolean)
  }
}

async function tryCodexTriage(items, config, { now = new Date() } = {}) {
  const prompt = buildTriagePrompt(items, config, now)
  const tempDir = await mkdtemp(join(tmpdir(), 'ai-radar-codex-'))
  const schemaPath = join(tempDir, 'triage-schema.json')
  const outputPath = join(tempDir, 'triage-output.json')

  try {
    await writeFile(schemaPath, JSON.stringify(TRIAGE_SCHEMA, null, 2))
    await execFile('codex', [
      'exec',
      '--skip-git-repo-check',
      '--sandbox', 'read-only',
      '--cd', process.cwd(),
      '--ephemeral',
      '--color', 'never',
      '--model', CODEX_MODEL,
      '--output-schema', schemaPath,
      '--output-last-message', outputPath,
      prompt
    ], {
      timeout: CODEX_TIMEOUT_MS,
      maxBuffer: 2 * 1024 * 1024
    })

    const raw = await readFile(outputPath, 'utf-8')
    const classifications = unwrapTriagePayload(JSON.parse(raw))
    return {
      ok: true,
      items: mergeTriagedItems(items, classifications, config, now)
    }
  } catch (error) {
    return {
      ok: false,
      error: `Codex triage unavailable: ${error.message}`
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

async function tryClaudeTriage(items, config, { now = new Date() } = {}) {
  const prompt = buildTriagePrompt(items, config, now)

  try {
    const { stdout } = await execFile('claude', [
      '--print',
      '--output-format', 'text',
      '--permission-mode', 'bypassPermissions',
      '--model', MODEL,
      '--json-schema', JSON.stringify(TRIAGE_SCHEMA),
      prompt
    ], {
      timeout: CLAUDE_TIMEOUT_MS,
      maxBuffer: 2 * 1024 * 1024
    })

    const classifications = unwrapTriagePayload(JSON.parse(extractJsonObject(stdout)))
    return {
      ok: true,
      items: mergeTriagedItems(items, classifications, config, now)
    }
  } catch (error) {
    return {
      ok: false,
      error: `Claude CLI triage unavailable: ${error.message}`
    }
  }
}

function heuristicTriage(items, config, { now = new Date() } = {}) {
  return items
    .map(item => {
      const titleHaystack = `${item.title}`.toLowerCase()
      const haystack = `${item.title} ${item.summary}`.toLowerCase()
      const ageHours = item.publishedAt
        ? (now.getTime() - new Date(item.publishedAt).getTime()) / (1000 * 60 * 60)
        : 999
      const keywordMatches = matchKeywords(haystack, config.project_keywords ?? [])
      const tutorialMatches = countMatches(haystack, TUTORIAL_HINTS)
      const signalMatches = countMatches(haystack, SIGNAL_HINTS)
      const noiseMatches = countMatches(haystack, NOISE_HINTS)
      const genericModelMatches = countMatches(haystack, GENERIC_MODEL_HINTS)
      const titleTutorialMatches = countMatches(titleHaystack, TUTORIAL_HINTS)
      const titleSignalMatches = countMatches(titleHaystack, SIGNAL_HINTS)
      const isReleaseSource = item.sourceType === 'github_releases'
      const isRecent = ageHours <= 72
      const hasDirectRelevance = keywordMatches >= 2
      const isGenericModelNews = genericModelMatches > 0 && keywordMatches === 0
      const isSecurityStory = haystack.includes('security') || haystack.includes('sandbox') || haystack.includes('prompt injection')
      const isDocPage = item.sourceType === 'html_page'

      let score = keywordMatches * 2
      if (item.category === 'model_api') score += 3
      if (item.category === 'tooling') score += 2
      if (item.category === 'skills_tutorials') score += 3
      if (tutorialMatches > 0) score += 2
      if (signalMatches > 0) score += 2
      if (isRecent) score += 1
      if (noiseMatches > 0) score -= 2
      if (isGenericModelNews) score -= 2
      if (isSecurityStory && keywordMatches < 2) score -= 1

      if (noiseMatches > 0 || isGenericModelNews) {
        return null
      }

      let layer = 'skip'
      if (isRecent && (isReleaseSource || (item.category === 'model_api' && titleSignalMatches > 0) || titleHaystack.includes('breaking'))) {
        layer = 'today_signal'
      } else if (hasDirectRelevance && (titleTutorialMatches > 0 || titleHaystack.includes('/guides/') || item.category === 'skills_tutorials' || (isDocPage && item.change_type === 'updated'))) {
        layer = 'skills_tutorials'
      } else if (hasDirectRelevance && isRecent && item.category === 'tooling' && titleSignalMatches > 0) {
        layer = 'today_signal'
      } else if (hasDirectRelevance && score >= 4) {
        layer = 'strategic_radar'
      } else if (keywordMatches >= 3 && score >= 5) {
        layer = 'strategic_radar'
      }

      const buildRelevance = keywordMatches > 0
        ? `Touches ${matchingKeywords(haystack, config.project_keywords ?? []).slice(0, 3).join(', ')}.`
        : null
      const normalizedItem = {
        ...item,
        title: rewriteTitle(item),
        summary: rewriteSummary(item)
      }

      return {
        ...normalizedItem,
        layer,
        score: Math.min(10, Math.max(1, score)),
        reason: buildReason(normalizedItem, layer, ageHours),
        build_relevance: buildRelevance,
        action: buildAction(normalizedItem, layer)
      }
    })
    .filter(Boolean)
    .filter(item => item.layer !== 'skip')
}

function mergeTriage(item, triage, config, now) {
  const fallback = heuristicTriage([item], config, { now })[0] ?? {
    ...item,
    layer: 'strategic_radar',
    score: 5,
    reason: 'Worth keeping on the radar until triage improves.',
    build_relevance: null,
    action: null
  }

  if (!triage || !VALID_LAYERS.has(triage.layer)) {
    return fallback
  }

  return {
    ...item,
    title: triage.display_title || fallback.title,
    summary: triage.summary_override || fallback.summary,
    layer: triage.layer,
    score: clampScore(triage.score ?? fallback.score),
    reason: triage.reason || fallback.reason,
    build_relevance: triage.build_relevance || fallback.build_relevance || null,
    action: triage.action || fallback.action || null
  }
}

function mergeTriagedItems(items, classifications, config, now) {
  const byId = new Map(classifications.map(entry => [entry.id, entry]))

  return items
    .map(item => mergeTriage(item, byId.get(item.id), config, now))
    .filter(item => item.layer !== 'skip')
}

function extractJsonObject(text) {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')

  if (start === -1 || end === -1 || end < start) {
    throw new Error('CLI response did not include a JSON object')
  }

  return text.slice(start, end + 1)
}

function buildTriagePrompt(items, config, now) {
  return [
    'You are a relevance triage engine for a frontier engineer building AI agent systems.',
    `Current focus: ${config.relevance_context}`,
    `Project keywords: ${(config.project_keywords ?? []).join(', ')}`,
    `Focus topics: ${(config.focus_topics ?? []).join(', ')}`,
    'Return a JSON object with a single top-level "items" array matching the provided schema.',
    'For each item, include: id, layer, score, reason, build_relevance, action, display_title, summary_override.',
    'Valid layers: today_signal, skills_tutorials, strategic_radar, skip.',
    'today_signal = breaking releases or directly impactful updates.',
    'skills_tutorials = practical workflows, skills, harnessing, docs, or examples worth using soon.',
    'strategic_radar = broader but still relevant ideas worth tracking.',
    'Skip generic AI news, broad security news, benchmark chatter, and low-value noise.',
    'For docs or official pages, summarize why the update matters instead of restating the page title.',
    '',
    JSON.stringify({
      now: now.toISOString(),
      items: items.map(item => ({
        id: item.id,
        title: item.title,
        summary: item.summary,
        url: item.url,
        category: item.category,
        sourceType: item.sourceType,
        changeType: item.change_type || null,
        sourceLabel: item.sourceLabel,
        publishedAt: item.publishedAt
      }))
    })
  ].join('\n')
}

function unwrapTriagePayload(payload) {
  if (Array.isArray(payload)) {
    return payload
  }

  if (payload && Array.isArray(payload.items)) {
    return payload.items
  }

  throw new Error('CLI triage output did not contain an items array')
}

function clampScore(value) {
  const number = Number(value)
  if (Number.isNaN(number)) {
    return 5
  }
  return Math.min(10, Math.max(0, number))
}

function countMatches(haystack, phrases) {
  return phrases.reduce((count, phrase) => count + (haystack.includes(phrase) ? 1 : 0), 0)
}

function matchKeywords(haystack, keywords) {
  return matchingKeywords(haystack, keywords).length
}

function matchingKeywords(haystack, keywords) {
  return keywords.filter(keyword => haystack.includes(String(keyword).toLowerCase()))
}

function buildReason(item, layer, ageHours) {
  if (layer === 'today_signal') {
    return ageHours <= 72
      ? 'Fresh release or important update worth checking today.'
      : 'Important update that still looks timely.'
  }

  if (layer === 'skills_tutorials') {
    if (item.sourceType === 'html_page') {
      return 'Official docs update worth skimming for new workflow or automation patterns.'
    }

    return 'Practical pattern or example you could apply this week.'
  }

  return `Broader signal worth tracking${item.sourceLabel ? ` from ${item.sourceLabel}` : ''}.`
}

function buildAction(item, layer) {
  if (layer === 'today_signal') {
    return `Review "${item.title}" and decide whether it changes the current build plan.`
  }

  if (layer === 'skills_tutorials') {
    if (item.sourceType === 'html_page') {
      return `Skim "${item.title}" and note any workflow changes worth adopting.`
    }

    return `Save "${item.title}" for focused implementation reading.`
  }

  return null
}

function rewriteTitle(item) {
  if (item.sourceType === 'github_commits' && item.title.startsWith('Anthropic Cookbook Commits: ')) {
    return item.title.replace('Anthropic Cookbook Commits: ', 'Anthropic Cookbook update: ')
  }

  if (item.sourceType === 'html_page' && item.change_type === 'updated') {
    return `${item.sourceLabel} updated`
  }

  return item.title
}

function rewriteSummary(item) {
  if (item.sourceType === 'html_page' && item.change_type === 'updated') {
    return item.summary ? `Updated official page. ${item.summary}` : 'Updated official docs page.'
  }

  return item.summary
}
