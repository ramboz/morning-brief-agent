const MODEL = process.env.AI_RADAR_CLAUDE_MODEL || 'claude-sonnet-4-20250514'
const VALID_LAYERS = new Set(['today_signal', 'skills_tutorials', 'strategic_radar', 'skip'])
const TUTORIAL_HINTS = ['tutorial', 'cookbook', 'guide', 'how to', 'walkthrough', 'example', 'examples', 'evaluation', 'eval', 'prompt', 'tool use', 'pattern']
const SIGNAL_HINTS = ['release', 'launch', 'launched', 'introducing', 'announcing', 'api', 'model', 'update', 'specification', 'general availability', 'now available']
const NOISE_HINTS = ['funding', 'hiring', 'webinar', 'podcast', 'conference', 'meetup', 'sponsor']
const GENERIC_MODEL_HINTS = ['sota', 'benchmarks', 'cost', 'open model', 'cheaper', 'faster']

export async function triageAiRadarItems(items, config, options = {}) {
  if (items.length === 0) {
    return {
      items: [],
      mode: 'empty',
      errors: []
    }
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      items: heuristicTriage(items, config, options),
      mode: 'heuristic',
      errors: []
    }
  }

  try {
    const triaged = await claudeTriage(items, config, options)
    return {
      items: triaged,
      mode: 'claude',
      errors: []
    }
  } catch (error) {
    return {
      items: heuristicTriage(items, config, options),
      mode: 'heuristic_fallback',
      errors: [`Claude triage unavailable: ${error.message}`]
    }
  }
}

async function claudeTriage(items, config, { now = new Date() } = {}) {
  const body = {
    model: MODEL,
    max_tokens: 2000,
    system: [
      'You are a relevance triage engine for a frontier engineer building AI agent systems.',
      `Current focus: ${config.relevance_context}`,
      `Project keywords: ${(config.project_keywords ?? []).join(', ')}`,
      'For each item, return an object with: id, layer, score, reason, build_relevance, action.',
      'Valid layers: today_signal, skills_tutorials, strategic_radar, skip.',
      'today_signal is for breaking releases or important updates, usually within 72 hours.',
      'skills_tutorials is for practical tutorials, cookbooks, examples, and tools worth trying this week.',
      'strategic_radar is for broader shifts and thoughtful analysis.',
      'action should be a concise imperative sentence only when the user should do something concrete.',
      'Return only valid JSON.'
    ].join(' '),
    messages: [
      {
        role: 'user',
        content: JSON.stringify({
          now: now.toISOString(),
          items: items.map(item => ({
            id: item.id,
            title: item.title,
            summary: item.summary,
            url: item.url,
            category: item.category,
            sourceLabel: item.sourceLabel,
            publishedAt: item.publishedAt
          }))
        })
      }
    ]
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key': process.env.ANTHROPIC_API_KEY
    },
    body: JSON.stringify(body)
  })

  if (!response.ok) {
    throw new Error(`Anthropic request failed (${response.status})`)
  }

  const payload = await response.json()
  const text = payload.content?.map(part => part.text || '').join('\n') || ''
  const classifications = JSON.parse(extractJsonArray(text))

  const byId = new Map(classifications.map(entry => [entry.id, entry]))

  return items
    .map(item => mergeTriage(item, byId.get(item.id), config, now))
    .filter(item => item.layer !== 'skip')
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
      } else if (hasDirectRelevance && (titleTutorialMatches > 0 || titleHaystack.includes('/guides/') || item.category === 'skills_tutorials')) {
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

      return {
        ...item,
        layer,
        score: Math.min(10, Math.max(1, score)),
        reason: buildReason(item, layer, ageHours),
        build_relevance: buildRelevance,
        action: buildAction(item, layer)
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
    layer: triage.layer,
    score: clampScore(triage.score ?? fallback.score),
    reason: triage.reason || fallback.reason,
    build_relevance: triage.build_relevance || fallback.build_relevance || null,
    action: triage.action || fallback.action || null
  }
}

function extractJsonArray(text) {
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')

  if (start === -1 || end === -1 || end < start) {
    throw new Error('Claude response did not include a JSON array')
  }

  return text.slice(start, end + 1)
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
    return 'Practical pattern or example you could apply this week.'
  }

  return `Broader signal worth tracking${item.sourceLabel ? ` from ${item.sourceLabel}` : ''}.`
}

function buildAction(item, layer) {
  if (layer === 'today_signal') {
    return `Review "${item.title}" and decide whether it changes the current build plan.`
  }

  if (layer === 'skills_tutorials') {
    return `Save "${item.title}" for focused implementation reading.`
  }

  return null
}
