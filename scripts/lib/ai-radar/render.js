const LAYER_ORDER = ['today_signal', 'skills_tutorials', 'strategic_radar']

export function renderAiRadarDigest(items, config, stats, options = {}) {
  const now = options.now ?? new Date()
  const grouped = groupItems(items, config.max_items_per_layer ?? {})
  const actions = buildActions(items)
  const lines = ['## 🤖 AI Radar', '']

  lines.push('### What Should I Do?')
  if (actions.length === 0) {
    lines.push('- Nothing urgent today. Read the top signal when you have a few minutes.')
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

    if (isMonday(now) && grouped.strategic_radar.length > 0) {
      appendSection(lines, 'On Your Radar *(Mondays only)*', grouped.strategic_radar)
    } else if ((grouped.today_signal.length + grouped.skills_tutorials.length) < 3 && grouped.strategic_radar.length > 0) {
      appendSection(lines, 'Worth Watching', grouped.strategic_radar.slice(0, 2))
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

function buildActions(items) {
  return [...items]
    .filter(item => item.action)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, 3)
    .map(item => item.action)
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
