import Parser from 'rss-parser'
import * as cheerio from 'cheerio'
import { createHash } from 'node:crypto'

const parser = new Parser({
  timeout: 15000,
  headers: {
    'User-Agent': browserHeaders()['User-Agent'],
    'Accept': browserHeaders().Accept,
    'Accept-Language': browserHeaders()['Accept-Language']
  }
})

export async function fetchAiRadarItems(config, options = {}) {
  const now = options.now ?? new Date()
  const lookbackHours = options.lookbackHours ?? 72
  const enabledSources = (config.sources ?? []).filter(source => source.enabled)
  const htmlWatchState = options.htmlWatchState ?? { pages: {} }

  const settled = await Promise.allSettled(
    enabledSources.map(source => fetchSource(source, { now, lookbackHours, htmlWatchState }))
  )

  const items = []
  const errors = []
  const htmlWatchUpdates = []

  for (let index = 0; index < settled.length; index += 1) {
    const result = settled[index]
    const source = enabledSources[index]

    if (result.status === 'fulfilled') {
      items.push(...result.value.items)
      if (result.value.watchUpdate) {
        htmlWatchUpdates.push(result.value.watchUpdate)
      }
      continue
    }

    errors.push(`${source.label}: ${result.reason.message}`)
  }

  return {
    items,
    errors,
    htmlWatchUpdates,
    stats: {
      sourcesChecked: enabledSources.length,
      sourceErrors: errors.length,
      itemsFetched: items.length
    }
  }
}

async function fetchSource(source, options) {
  switch (source.type) {
    case 'rss':
    case 'atom':
      return fetchFeedSource(source, options)
    case 'github_releases':
      return fetchGitHubReleases(source, options)
    case 'github_commits':
      return fetchGitHubCommits(source, options)
    case 'github_trending':
      return fetchGitHubTrending(source, options)
    case 'html_page':
      return fetchHtmlPageSource(source, options)
    default:
      throw new Error(`Unsupported source type: ${source.type}`)
  }
}

async function fetchFeedSource(source, { now, lookbackHours }) {
  const feed = await parser.parseURL(source.url)
  const cutoff = now.getTime() - lookbackHours * 60 * 60 * 1000

  return {
    items: (feed.items ?? [])
    .map(item => normalizeFeedItem(source, item))
    .filter(Boolean)
    .filter(item => matchesSourceKeywords(item, source))
    .filter(item => !item.publishedAt || new Date(item.publishedAt).getTime() >= cutoff)
  }
}

async function fetchGitHubReleases(source, { now, lookbackHours }) {
  const response = await fetch(source.url, {
    headers: githubHeaders()
  })

  if (!response.ok) {
    throw new Error(`GitHub releases request failed (${response.status})`)
  }

  const releases = await response.json()
  const cutoff = now.getTime() - lookbackHours * 60 * 60 * 1000

  return {
    items: releases
    .filter(release => !release.prerelease && !isPreReleaseTag(release.tag_name))
    .map(release => ({
      id: `${source.id}:${release.id ?? release.tag_name}`,
      sourceId: source.id,
      sourceLabel: source.label,
      sourceType: source.type,
      category: source.category,
      title: release.name || release.tag_name || 'GitHub release',
      url: release.html_url,
      summary: compactText(release.body || ''),
      publishedAt: release.published_at || release.created_at || null
    }))
    .filter(item => matchesSourceKeywords(item, source))
    .filter(item => !item.publishedAt || new Date(item.publishedAt).getTime() >= cutoff)
  }
}

async function fetchGitHubCommits(source, { now, lookbackHours }) {
  const response = await fetch(source.url, {
    headers: githubHeaders()
  })

  if (!response.ok) {
    throw new Error(`GitHub commits request failed (${response.status})`)
  }

  const commits = await response.json()
  const cutoff = now.getTime() - lookbackHours * 60 * 60 * 1000

  return {
    items: commits
    .map(commit => ({
      id: `${source.id}:${commit.sha}`,
      sourceId: source.id,
      sourceLabel: source.label,
      sourceType: source.type,
      category: source.category,
      title: formatCommitTitle(source.label, commit.commit?.message || 'GitHub commit'),
      url: commit.html_url,
      summary: compactText(commit.commit?.message || ''),
      publishedAt: commit.commit?.author?.date || null
    }))
    .filter(item => matchesSourceKeywords(item, source))
    .filter(item => !item.publishedAt || new Date(item.publishedAt).getTime() >= cutoff)
  }
}

async function fetchGitHubTrending(source, { now }) {
  const response = await fetch(source.url, {
    headers: browserHeaders()
  })

  if (!response.ok) {
    throw new Error(`GitHub trending request failed (${response.status})`)
  }

  const html = await response.text()
  const $ = cheerio.load(html)

  return {
    items: $('article.Box-row').toArray().slice(0, 5).map(article => {
    const row = $(article)
    const repoPath = row.find('h2 a').attr('href')?.trim()
    const title = row.find('h2').text().replace(/\s+/g, ' ').trim()
    const summary = row.find('p').text().replace(/\s+/g, ' ').trim()
    const starsToday = row.find('span.d-inline-block.float-sm-right').text().replace(/\s+/g, ' ').trim()

    return {
      id: `${source.id}:${repoPath}`,
      sourceId: source.id,
      sourceLabel: source.label,
      sourceType: source.type,
      category: source.category,
      title,
      url: repoPath ? `https://github.com${repoPath}` : source.url,
      summary: compactText([summary, starsToday].filter(Boolean).join(' ')),
      publishedAt: now.toISOString()
    }
  }).filter(item => item.url)
  }
}

async function fetchHtmlPageSource(source, { now, htmlWatchState }) {
  const response = await fetch(source.url, {
    headers: browserHeaders(source.url)
  })

  if (!response.ok) {
    throw new Error(`HTML page request failed (${response.status})`)
  }

  const html = await response.text()
  const $ = cheerio.load(html)
  const title = extractHtmlTitle($, source)
  const summary = extractHtmlSummary($, source)
  const watchText = extractWatchText($, source)
  const contentHash = hashText(watchText)
  const key = source.id
  const previous = htmlWatchState.pages?.[key]
  const publishedAt = extractPublishedAt($, source) || now.toISOString()

  const watchUpdate = {
    key,
    url: source.url,
    title,
    hash: contentHash,
    publishedAt,
    lastSeenAt: now.toISOString()
  }

  if (previous?.hash === contentHash) {
    return {
      items: [],
      watchUpdate
    }
  }

  if (!previous && source.emit_on_first_seen !== true) {
    return {
      items: [],
      watchUpdate
    }
  }

  const item = {
    id: `${source.id}:${contentHash.slice(0, 12)}`,
    sourceId: source.id,
    sourceLabel: source.label,
    sourceType: source.type,
    category: source.category,
    title,
    url: source.url,
    summary,
    publishedAt,
    change_type: previous ? 'updated' : 'first_seen'
  }

  return {
    items: matchesSourceKeywords(item, source) ? [item] : [],
    watchUpdate
  }
}

function normalizeFeedItem(source, item) {
  const url = item.link || item.guid || item.id

  if (!url || !item.title) {
    return null
  }

  return {
    id: `${source.id}:${url}`,
    sourceId: source.id,
    sourceLabel: source.label,
    sourceType: source.type,
    category: source.category,
    title: compactText(item.title),
    url,
    summary: compactText(item.contentSnippet || item.summary || item.content || ''),
    publishedAt: item.isoDate || item.pubDate || item.published || null
  }
}

function compactText(value) {
  const text = String(value)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return text.length > 500 ? `${text.slice(0, 497)}...` : text
}

function firstLine(value) {
  return String(value).split('\n')[0].trim()
}

function formatCommitTitle(sourceLabel, value) {
  const line = firstLine(value)
    .replace(/^[a-z]+(\([^)]+\))?:\s*/i, '')
    .replace(/\s*\(#\d+\)\s*$/, '')
    .trim()

  if (!line) {
    return sourceLabel
  }

  return `${sourceLabel}: ${line}`
}

function githubHeaders() {
  const token = process.env.GITHUB_TOKEN || process.env.GITHUB_COM_TOKEN
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'morning-brief-agent/2.0'
  }

  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  return headers
}

function browserHeaders(url = '') {
  const target = new URL(url || 'https://example.com')
  const origin = `${target.protocol}//${target.host}`

  return {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-User': '?1',
    'Sec-Fetch-Dest': 'document',
    'Referer': origin
  }
}

function matchesSourceKeywords(item, source) {
  const required = source.required_keywords ?? []

  if (required.length === 0) {
    return true
  }

  const haystack = `${item.title} ${item.summary}`.toLowerCase()
  return required.some(keyword => haystack.includes(String(keyword).toLowerCase()))
}

function extractHtmlTitle($, source) {
  const selectors = [
    source.title_selector,
    'meta[property="og:title"]',
    'meta[name="twitter:title"]',
    'h1',
    'title'
  ].filter(Boolean)

  for (const selector of selectors) {
    const value = selector.startsWith('meta[')
      ? $(selector).attr('content')
      : $(selector).first().text()
    const text = compactText(value || '')
    if (text) {
      return text
    }
  }

  return source.label
}

function extractHtmlSummary($, source) {
  const metaSelectors = [
    source.summary_selector,
    'meta[name="description"]',
    'meta[property="og:description"]'
  ].filter(Boolean)

  for (const selector of metaSelectors) {
    const value = selector.startsWith('meta[')
      ? $(selector).attr('content')
      : $(selector).first().text()
    const text = compactText(value || '')
    if (text && isUsefulSummary(text)) {
      return text
    }
  }

  const blockSelectors = ['article p', 'main p', 'p']

  for (const selector of blockSelectors) {
    const candidates = $(selector).toArray()
      .map(node => compactText($(node).text() || ''))
      .filter(text => text && isUsefulSummary(text))

    if (candidates.length > 0) {
      return candidates[0]
    }
  }

  return ''
}

function extractWatchText($, source) {
  const selectors = [
    source.watch_selector,
    'article',
    'main',
    'body'
  ].filter(Boolean)

  for (const selector of selectors) {
    const text = compactText($(selector).first().text() || '')
    if (text) {
      return text
    }
  }

  return ''
}

function extractPublishedAt($, source) {
  const selectors = [
    source.published_selector,
    'meta[property="article:published_time"]',
    'meta[name="article:published_time"]',
    'time[datetime]'
  ].filter(Boolean)

  for (const selector of selectors) {
    const value = selector.startsWith('meta[')
      ? $(selector).attr('content')
      : $(selector).first().attr('datetime') || $(selector).first().text()
    const text = compactText(value || '')
    if (!text) {
      continue
    }

    const date = new Date(text)
    if (!Number.isNaN(date.getTime())) {
      return date.toISOString()
    }
  }

  return null
}

function hashText(value) {
  return createHash('sha256').update(String(value)).digest('hex')
}

function isUsefulSummary(text) {
  return text.length >= 40 && !text.startsWith('By ')
}

/**
 * Detect pre-release versions by tag name pattern.
 * Matches: alpha, beta, rc, dev, canary, nightly, preview, next, snapshot, pre
 * Examples: v0.117.0-alpha.12, 2.0.0-beta.3, 1.0.0-rc1
 * @param {string} tag - The release tag name
 * @returns {boolean}
 */
function isPreReleaseTag(tag) {
  if (!tag) return false
  return /[-.](?:alpha|beta|rc|dev|canary|nightly|preview|next|snapshot|pre)\b/i.test(tag)
}
