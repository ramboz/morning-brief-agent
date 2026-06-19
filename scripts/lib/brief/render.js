export function renderDailyBrief({ date, generatedAt = new Date(), sections = [] } = {}) {
  const includedSections = sections.filter(section => section.included && section.markdown?.trim())
  const actions = includedSections.flatMap(section =>
    (section.actions ?? []).map(action => ({
      source: section.title,
      text: action
    }))
  )

  const lines = [`# Daily Brief - ${date}`, '']

  lines.push('## What Should I Do?')
  if (actions.length === 0) {
    lines.push('- No source actions today.')
  } else {
    for (const action of actions) {
      lines.push(`- **${action.source}:** ${action.text}`)
    }
  }
  lines.push('')

  lines.push('## Source Sections')
  if (includedSections.length === 0) {
    lines.push('_No source sections produced content._')
  } else {
    for (const section of includedSections) {
      lines.push(nestSourceMarkdown(section.markdown))
      lines.push('')
    }
  }

  lines.push('## Source Results')
  for (const section of sections) {
    lines.push(`- ${section.title}: ${formatSourceResult(section)}`)
  }
  lines.push('')
  lines.push(`_Generated: ${generatedAt.toISOString()}_`)

  return lines.join('\n').trimEnd()
}

function formatSourceResult(section) {
  if (section.status === 'included') {
    return includedSummary(section)
  }

  const detail = firstDetail(section)
  return detail ? `${section.status} - ${detail}` : section.status
}

function nestSourceMarkdown(markdown) {
  return markdown
    .trim()
    .split('\n')
    .map(line => line.startsWith('#') ? `#${line}` : line)
    .join('\n')
}

function includedSummary(section) {
  const actions = section.actions?.length ?? 0
  const warnings = section.warnings?.length ?? 0
  const parts = [`${actions} action${actions === 1 ? '' : 's'}`]

  if (warnings > 0) {
    parts.push(`${warnings} warning${warnings === 1 ? '' : 's'}`)
  }

  return `included (${parts.join(', ')})`
}

function firstDetail(section) {
  return section.errors?.[0] || null
}
