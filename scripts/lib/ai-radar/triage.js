const TUTORIAL_HINTS = ['tutorial', 'cookbook', 'guide', 'how to', 'walkthrough', 'example', 'examples', 'evaluation', 'eval', 'prompt', 'tool use', 'pattern']
const SIGNAL_HINTS = ['release', 'launch', 'launched', 'introducing', 'announcing', 'api', 'model', 'update', 'specification', 'general availability', 'now available']
const NOISE_HINTS = ['funding', 'hiring', 'webinar', 'podcast', 'conference', 'meetup', 'sponsor']
const GENERIC_MODEL_HINTS = ['sota', 'benchmarks', 'cost', 'open model', 'cheaper', 'faster']

/**
 * Relevance triage for AI Radar items.
 *
 * IMPORTANT: LLM-based triage is intentionally NOT performed here. The running
 * agent (Cowork / Claude Code / Claude-in-Chrome) triages the raw items on the
 * user's Claude *subscription* — see `skills/morning-ai-radar/SKILL.md` Step 2.
 * This module only provides a keyword heuristic as a fallback for standalone /
 * unattended CLI runs where no agent is present to reason over `raw_items`.
 *
 * Do NOT reintroduce an `api.anthropic.com` / `ANTHROPIC_API_KEY` call here —
 * that would double-bill the user for reasoning the agent already does. See the
 * "Subscription, not API" project decision.
 */
export async function triageAiRadarItems(items, config, options = {}) {
  if (items.length === 0) {
    return {
      items: [],
      mode: 'empty',
      errors: []
    }
  }

  return {
    items: heuristicTriage(items, config, options),
    mode: 'heuristic',
    errors: []
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
