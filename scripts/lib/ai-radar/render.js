const LAYER_ORDER = ['today_signal', 'skills_tutorials', 'strategic_radar']
const ACTION_LIMIT = 3
const ACTION_SCORE_FLOOR = 7
const STRATEGIC_ACTION_SCORE_FLOOR = 8

export function renderAiRadarDigest(items, config, stats, options = {}) {
  const now = options.now ?? new Date()
  const grouped = normalizeGroupedActions(groupItems(items, config.max_items_per_layer ?? {}))
  const strategicSection = getStrategicSection(grouped, now)
  const actions = buildActions(actionSourceItems(grouped, strategicSection), config)
  const lines = ['## 🤖 AI Radar', '']

  lines.push('### What Should I Do?')
  if (actions.length === 0) {
    lines.push(`- ${quietDayAction(items)}`)
  } else {
    for (const action of actions) {
      lines.push(`- ${action}`)
    }
  }
  lines.push('')

  if (grouped.today_signal.length === 0 && grouped.skills_tutorials.length === 0 && grouped.strategic_radar.length === 0) {
    lines.push('_Nothing significant today._')
    lines.push('')
  } else {
    appendSection(lines, "Today's Signal", grouped.today_signal)
    appendSection(lines, 'Skills & Tutorials', grouped.skills_tutorials)

    if (strategicSection) {
      appendSection(lines, strategicSection.title, strategicSection.items)
    }
  }

  lines.push('---')
  const skippedSummary = stats.sourcesSkipped > 0
    ? ` · ${stats.sourcesSkipped} deferred`
    : ''
  lines.push(`*Sources: ${stats.sourcesChecked} checked${skippedSummary} · ${stats.itemsFetched} items fetched · ${stats.itemsAfterTriage} after triage · Last run: ${formatTime(now)}*`)
  if ((stats.sourceErrors ?? 0) > 0) {
    lines.push(`*Warnings: ${stats.sourceErrors} source${stats.sourceErrors === 1 ? '' : 's'} failed during fetch.*`)
  }

  return {
    markdown: lines.join('\n'),
    grouped,
    actions
  }
}

function groupItems(items, caps) {
  const grouped = {
    today_signal: [],
    skills_tutorials: [],
    strategic_radar: []
  }

  const sorted = [...items].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))

  for (const layer of LAYER_ORDER) {
    const cap = caps[layer] ?? 5
    grouped[layer] = sorted.filter(item => item.layer === layer).slice(0, cap)
  }

  return grouped
}

function normalizeGroupedActions(grouped) {
  return Object.fromEntries(
    Object.entries(grouped).map(([layer, items]) => [
      layer,
      items.map(item => ({
        ...item,
        action: isActionCandidate(item) ? buildConcreteAction(item) : null
      }))
    ])
  )
}

function getStrategicSection(grouped, now) {
  if (grouped.strategic_radar.length === 0) {
    return null
  }

  if (isMonday(now)) {
    return {
      title: 'On Your Radar *(Mondays only)*',
      items: grouped.strategic_radar
    }
  }

  if ((grouped.today_signal.length + grouped.skills_tutorials.length) < 3) {
    return {
      title: 'Worth Watching',
      items: grouped.strategic_radar.slice(0, 2)
    }
  }

  return null
}

function actionSourceItems(grouped, strategicSection) {
  return [
    ...grouped.today_signal,
    ...grouped.skills_tutorials,
    ...(strategicSection?.items ?? [])
  ]
}

function buildActions(items, config = {}) {
  const limit = config.max_actions ?? ACTION_LIMIT

  return [...items]
    .filter(isActionCandidate)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, limit)
    .map(buildConcreteAction)
    .filter(Boolean)
}

function isActionCandidate(item) {
  const score = item.score ?? 0

  if (item.layer === 'strategic_radar') {
    return score >= STRATEGIC_ACTION_SCORE_FLOOR
  }

  return score >= ACTION_SCORE_FLOOR && ['today_signal', 'skills_tutorials'].includes(item.layer)
}

function buildConcreteAction(item) {
  const title = item.title ?? 'this item'

  if (item.layer === 'today_signal') {
    return `Review "${title}" and decide whether it changes this week's build plan.`
  }

  if (item.layer === 'skills_tutorials') {
    if (item.sourceType === 'html_page') {
      return `Skim "${title}" for 10 minutes; save one workflow change if it applies.`
    }

    return `Save "${title}" for focused implementation reading; extract one reusable pattern.`
  }

  if (item.layer === 'strategic_radar') {
    return `Evaluate "${title}" during weekly radar review; ignore it for today's build unless it changes tool direction.`
  }

  return null
}

function quietDayAction(items) {
  if (items.length === 0) {
    return 'No action needed today. Nothing cleared the AI Radar threshold.'
  }

  return 'No action needed today. Keep these as background reading; nothing needs a build-plan decision.'
}

function appendSection(lines, title, items) {
  if (items.length === 0) {
    return
  }

  lines.push(`### ${title}`)
  for (const item of items) {
    const prefix = item.build_relevance ? '📌 ' : ''
    const detail = item.build_relevance
      ? `${item.reason} Directly relevant: ${item.build_relevance}`
      : item.reason

    lines.push(`- ${prefix}**${item.title}** — ${detail}`)
    lines.push(`  [→ Read](${item.url})`)
  }
  lines.push('')
}

function formatTime(now) {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(now)
}

function isMonday(now) {
  return now.getDay() === 1
}
