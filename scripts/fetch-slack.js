#!/usr/bin/env node

/**
 * fetch-slack.js — Slack API → JSON (fallback if connector unavailable)
 *
 * Modes:
 *   --brief              Lookback scan: mentions, DMs, thread updates, priority channels
 *   --search "query"     Deep Dive: message search by keyword/channel/sender
 *
 * Standalone: node scripts/fetch-slack.js --brief
 * Reference:  specs/04-slack.md
 *
 * Setup: Create a Slack app with user token scopes (xoxp-):
 *   channels:history, groups:history, im:history, mpim:history,
 *   channels:read, groups:read, im:read, mpim:read,
 *   users:read, reactions:read, search:read
 */

import dotenv from 'dotenv'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebClient } from '@slack/web-api'
import { parseArgs, loadConfig, envelope } from './lib/config.js'

dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), '.env') })

const TOOL = 'slack'

/** Rate limit helper — 1.2s between Tier 3 calls (50 req/min) */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

/** In-memory cache for user ID → display name resolution */
const userCache = new Map()

/**
 * Construct a Slack deep link without an API call.
 * workspaceUrl comes from auth.test() — e.g. "https://adobe.slack.com/"
 * @param {string} workspaceUrl - Trailing-slash workspace URL from auth.test()
 * @param {string} channelId
 * @param {string} ts - Slack timestamp e.g. "1774231595.570069"
 * @returns {string}
 */
function makePermalink(workspaceUrl, channelId, ts, threadTs = null) {
  const tsNoDot = ts.replace('.', '')
  const base = `${workspaceUrl}archives/${channelId}/p${tsNoDot}`
  if (threadTs && threadTs !== ts) {
    return `${base}?thread_ts=${threadTs}&cid=${channelId}`
  }
  return base
}

/**
 * Construct a Slack channel URL (no specific message).
 * @param {string} workspaceUrl
 * @param {string} channelId
 * @returns {string}
 */
function makeChannelUrl(workspaceUrl, channelId) {
  return `${workspaceUrl}archives/${channelId}`
}

/**
 * Resolve a Slack user ID to a display name object.
 * @param {WebClient} slack
 * @param {string} userId
 * @returns {Promise<{ id: string, name: string }>}
 */
async function resolveUser(slack, userId) {
  if (!userId) return { id: 'unknown', name: 'unknown' }
  if (userCache.has(userId)) return userCache.get(userId)
  try {
    const res = await slack.users.info({ user: userId })
    const user = {
      id: userId,
      name: res.user?.profile?.display_name || res.user?.real_name || res.user?.name || userId
    }
    userCache.set(userId, user)
    return user
  } catch {
    const user = { id: userId, name: userId }
    userCache.set(userId, user)
    return user
  }
}

/**
 * Replace <@UXXXXX> mentions in message text with @displayname.
 * @param {string} text
 * @returns {string}
 */
function resolveText(text) {
  if (!text) return ''
  return text.replace(/<@([A-Z0-9]+)>/g, (_, id) => {
    const user = userCache.get(id)
    return user ? `@${user.name}` : `<@${id}>`
  })
}

/**
 * Whether a bot message should be included based on exception keywords.
 * @param {object} msg
 * @param {string[]} keywords
 * @returns {boolean}
 */
function includeBotMessage(msg, keywords) {
  const text = (msg.text || '').toLowerCase()
  return keywords.some(kw => text.includes(kw.toLowerCase()))
}

/**
 * Get all channels the authenticated user is a member of (paginated).
 * @param {WebClient} slack
 * @returns {Promise<{ id: string, name: string }[]>}
 */
async function getAllUserChannels(slack) {
  const channels = []
  let cursor
  do {
    const res = await slack.users.conversations({
      types: 'public_channel,private_channel',
      exclude_archived: true,
      limit: 200,
      ...(cursor ? { cursor } : {})
    })
    for (const ch of (res.channels || [])) {
      channels.push({ id: ch.id, name: ch.name })
    }
    cursor = res.response_metadata?.next_cursor
  } while (cursor)
  return channels
}

/**
 * Resolve section channel names to IDs from the full channel list.
 * @param {WebClient} slack
 * @param {object} config - slack-sections.json content
 * @param {{ id: string, name: string }[]} allChannels
 * @returns {Promise<{ id: string, name: string, section: string }[]>}
 */
async function resolvePriorityChannels(config, allChannels) {
  const byName = new Map()
  for (const ch of allChannels) {
    byName.set(ch.name.toLowerCase(), ch)
  }

  const resolved = []
  for (const section of (config.sections || [])) {
    for (const chName of (section.channels || [])) {
      const key = chName.replace(/^#/, '').toLowerCase()
      const ch = byName.get(key)
      if (ch) {
        resolved.push({ id: ch.id, name: ch.name, section: section.name })
      } else {
        console.error(`[slack] Warning: channel not found or not a member: ${chName}`)
      }
    }
  }
  return resolved
}

/**
 * Fetch messages where the user was mentioned (via search API — single call covering all channels).
 * Search results include permalinks natively; workspaceUrl used as fallback.
 * @param {WebClient} slack
 * @param {string} userId
 * @param {Date} since
 * @param {Map<string, string>} channelNameById
 * @param {string} workspaceUrl
 * @returns {Promise<object[]>}
 */
async function fetchMentions(slack, userId, since, channelNameById, workspaceUrl) {
  const dateStr = since.toISOString().slice(0, 10)
  try {
    const res = await slack.search.messages({
      query: `<@${userId}> after:${dateStr}`,
      count: 100
    })
    const mentions = []
    for (const match of (res.messages?.matches || [])) {
      const user = await resolveUser(slack, match.user || match.username)
      const channelId = match.channel?.id || ''
      mentions.push({
        channelId,
        channelName: match.channel?.name || channelNameById.get(channelId) || '',
        ts: match.ts,
        user,
        text: resolveText(match.text),
        threadTs: match.thread_ts && match.thread_ts !== match.ts ? match.thread_ts : null,
        permalink: match.permalink || makePermalink(workspaceUrl, channelId, match.ts, match.thread_ts)
      })
    }
    return mentions
  } catch (err) {
    console.error('[slack] Search/mentions API failed:', err.message)
    return []
  }
}

/**
 * Fetch thread updates — threads the user replied to with new replies from others.
 * @param {WebClient} slack
 * @param {string} userId
 * @param {Date} since
 * @param {Map<string, string>} channelNameById
 * @param {string} workspaceUrl
 * @returns {Promise<object[]>}
 */
async function fetchThreadUpdates(slack, userId, since, channelNameById, workspaceUrl) {
  const dateStr = since.toISOString().slice(0, 10)
  try {
    const res = await slack.search.messages({
      query: `from:<@${userId}> in:threads after:${dateStr}`,
      count: 50
    })

    const updates = []
    const seen = new Set()

    for (const match of (res.messages?.matches || [])) {
      if (!match.thread_ts || match.thread_ts === match.ts) continue
      const key = `${match.channel?.id}:${match.thread_ts}`
      if (seen.has(key)) continue
      seen.add(key)

      try {
        await sleep(1200)
        const thread = await slack.conversations.replies({
          channel: match.channel?.id,
          ts: match.thread_ts,
          oldest: (since.getTime() / 1000).toString()
        })

        const allReplies = (thread.messages || []).slice(1) // skip parent message
        const myLastReplyTs = allReplies
          .filter(m => m.user === userId)
          .map(m => parseFloat(m.ts))
          .sort((a, b) => b - a)[0] || 0

        const newReplies = allReplies.filter(
          m => m.user !== userId && parseFloat(m.ts) > myLastReplyTs
        )
        if (newReplies.length === 0) continue

        const channelId = match.channel?.id || ''
        const resolvedReplies = []
        for (const r of newReplies) {
          const user = await resolveUser(slack, r.user)
          resolvedReplies.push({
            ts: r.ts,
            user,
            text: resolveText(r.text),
            permalink: makePermalink(workspaceUrl, channelId, r.ts, match.thread_ts)
          })
        }

        updates.push({
          channelId,
          channelName: match.channel?.name || channelNameById.get(channelId) || '',
          threadTs: match.thread_ts,
          threadUrl: makePermalink(workspaceUrl, channelId, match.thread_ts),
          parentText: resolveText(thread.messages?.[0]?.text || ''),
          newReplies: resolvedReplies,
          totalNewReplies: resolvedReplies.length
        })
      } catch (err) {
        console.error(`[slack] Thread fetch failed (${match.thread_ts}):`, err.message)
      }
    }
    return updates
  } catch (err) {
    console.error('[slack] Thread search failed:', err.message)
    return []
  }
}

/**
 * Fetch DMs and group DMs with activity since `since`.
 * @param {WebClient} slack
 * @param {string} userId
 * @param {Date} since
 * @param {string} workspaceUrl
 * @returns {Promise<object[]>}
 */
async function fetchDMs(slack, userId, since, workspaceUrl) {
  const dms = []
  const oldest = (since.getTime() / 1000).toString()

  try {
    const res = await slack.conversations.list({ types: 'im,mpim', limit: 100 })
    for (const dm of (res.channels || [])) {
      try {
        await sleep(1200)
        const hist = await slack.conversations.history({ channel: dm.id, oldest, limit: 50 })
        if (!hist.messages?.length) continue

        const messages = []
        for (const msg of hist.messages) {
          if (msg.subtype) continue
          const user = await resolveUser(slack, msg.user || '')
          messages.push({
            ts: msg.ts,
            isFromMe: msg.user === userId,
            user,
            text: resolveText(msg.text),
            permalink: makePermalink(workspaceUrl, dm.id, msg.ts)
          })
        }
        if (!messages.length) continue

        const otherUserId = dm.user || (dm.members || []).find(id => id !== userId)
        const withUser = otherUserId
          ? await resolveUser(slack, otherUserId)
          : { id: 'group', name: dm.name || 'Group DM' }

        dms.push({ dmId: dm.id, url: makeChannelUrl(workspaceUrl, dm.id), withUser, messages })
      } catch (err) {
        console.error(`[slack] DM fetch failed (${dm.id}):`, err.message)
      }
    }
  } catch (err) {
    console.error('[slack] DMs list failed:', err.message)
  }
  return dms
}

/**
 * Fetch full message history for priority channels (sequential, rate-limited).
 * Filters out the authenticated user's own messages.
 * @param {WebClient} slack
 * @param {{ id: string, name: string, section: string }[]} priorityChannels
 * @param {string} userId
 * @param {Date} since
 * @param {boolean} ignoreBots
 * @param {string[]} botExceptionKeywords
 * @param {string} workspaceUrl
 * @returns {Promise<object[]>}
 */
async function fetchChannelHistories(slack, priorityChannels, userId, since, ignoreBots, botExceptionKeywords, workspaceUrl) {
  const oldest = (since.getTime() / 1000).toString()
  const results = []

  for (const ch of priorityChannels) {
    try {
      await sleep(1200)
      const hist = await slack.conversations.history({ channel: ch.id, oldest, limit: 200 })
      const messages = []

      for (const msg of (hist.messages || [])) {
        if (msg.user === userId) continue // filter own messages
        if ((msg.subtype === 'bot_message' || msg.bot_id) && ignoreBots) {
          if (!includeBotMessage(msg, botExceptionKeywords)) continue
        }
        const user = await resolveUser(slack, msg.user || msg.bot_id || 'bot')
        const msgThreadTs = msg.thread_ts && msg.thread_ts !== msg.ts ? msg.thread_ts : null
        messages.push({
          ts: msg.ts,
          user,
          text: resolveText(msg.text),
          permalink: makePermalink(workspaceUrl, ch.id, msg.ts, msgThreadTs),
          replyCount: msg.reply_count || 0,
          reactions: (msg.reactions || []).map(r => ({ name: r.name, count: r.count }))
        })
      }

      results.push({
        id: ch.id,
        name: ch.name,
        url: makeChannelUrl(workspaceUrl, ch.id),
        section: ch.section,
        messages,
        threadReplies: []
      })
    } catch (err) {
      console.error(`[slack] Channel history failed (${ch.name}):`, err.message)
    }
  }
  return results
}

/**
 * Brief mode: gather mentions, DMs, thread updates, and priority channel histories.
 * @param {WebClient} slack
 * @param {string} userId
 * @param {number} lookbackHours
 * @param {string} workspaceUrl - Trailing-slash workspace URL from auth.test()
 * @returns {Promise<object>}
 */
async function runBrief(slack, userId, lookbackHours, workspaceUrl) {
  const since = new Date(Date.now() - lookbackHours * 60 * 60 * 1000)

  let config = { sections: [], ignore_bots: true, bot_exception_keywords: [] }
  try {
    config = await loadConfig('morning-slack', 'slack-sections.json')
  } catch (err) {
    console.error('[slack]', err.message, '— skipping channel summaries, still fetching mentions and DMs')
  }

  const ignoreBots = config.ignore_bots !== false
  const botExceptionKeywords = config.bot_exception_keywords || ['incident', 'alert', 'failed', 'error', 'outage', 'degraded']

  const allChannels = await getAllUserChannels(slack)
  const channelNameById = new Map(allChannels.map(ch => [ch.id, ch.name]))
  const priorityChannels = await resolvePriorityChannels(config, allChannels)

  // Mentions and DMs can run concurrently; thread updates needs search too
  const [mentions, threadUpdates, directMessages] = await Promise.all([
    fetchMentions(slack, userId, since, channelNameById, workspaceUrl),
    fetchThreadUpdates(slack, userId, since, channelNameById, workspaceUrl),
    fetchDMs(slack, userId, since, workspaceUrl)
  ])

  // Channel histories are sequential due to rate limits
  const channels = await fetchChannelHistories(
    slack, priorityChannels, userId, since, ignoreBots, botExceptionKeywords, workspaceUrl
  )

  const priorityIds = new Set(priorityChannels.map(ch => ch.id))
  const otherChannelCount = allChannels.filter(ch => !priorityIds.has(ch.id)).length
  const otherMentionCount = mentions.filter(m => !priorityIds.has(m.channelId)).length

  return {
    mentions,
    threadUpdates,
    directMessages,
    channels,
    otherChannelsActivity: {
      totalChannels: otherChannelCount,
      mentionCount: otherMentionCount
    }
  }
}

/**
 * Search mode: search all accessible messages by query.
 * @param {WebClient} slack
 * @param {string} query
 * @returns {Promise<object>}
 */
async function runSearch(slack, query) {
  const res = await slack.search.messages({ query, count: 100 })
  const results = []
  for (const match of (res.messages?.matches || [])) {
    const user = await resolveUser(slack, match.user || match.username || 'unknown')
    results.push({
      channelId: match.channel?.id || '',
      channelName: match.channel?.name || '',
      ts: match.ts,
      user,
      text: resolveText(match.text),
      permalink: match.permalink || ''
    })
  }
  return { query, results, total: res.messages?.total || results.length }
}

/**
 * Context mode: fetch full thread context for a specific message.
 * Used by the orchestrator before generating a draft reply.
 * @param {WebClient} slack
 * @param {string} channelId
 * @param {string} threadTs - Thread parent timestamp
 * @param {string} workspaceUrl
 * @returns {Promise<object>}
 */
async function runContext(slack, channelId, threadTs, workspaceUrl) {
  // Fetch full thread
  const thread = await slack.conversations.replies({
    channel: channelId,
    ts: threadTs,
    limit: 100
  })

  const messages = []
  for (const msg of (thread.messages || [])) {
    const user = await resolveUser(slack, msg.user || '')
    messages.push({
      ts: msg.ts,
      user,
      text: resolveText(msg.text),
      permalink: makePermalink(workspaceUrl, channelId, msg.ts, msg.ts === threadTs ? null : threadTs),
      isParent: msg.ts === threadTs
    })
  }

  // Fetch recent channel context (last 20 messages around the thread)
  let channelContext = []
  try {
    const hist = await slack.conversations.history({
      channel: channelId,
      limit: 20,
      latest: threadTs
    })
    for (const msg of (hist.messages || [])) {
      if (msg.subtype) continue
      const user = await resolveUser(slack, msg.user || '')
      channelContext.push({
        ts: msg.ts,
        user,
        text: resolveText(msg.text)
      })
    }
  } catch {
    // Channel context is best-effort
  }

  // Get channel info
  let channelName = ''
  try {
    const info = await slack.conversations.info({ channel: channelId })
    channelName = info.channel?.name || ''
  } catch {
    // fallback
  }

  return {
    channelId,
    channelName,
    channelUrl: makeChannelUrl(workspaceUrl, channelId),
    threadTs,
    threadUrl: makePermalink(workspaceUrl, channelId, threadTs),
    messages,
    channelContext
  }
}

async function main() {
  const { mode, query, lookbackHours } = parseArgs()
  const args = process.argv.slice(2)

  const token = process.env.SLACK_USER_TOKEN
  if (!token) {
    console.log(JSON.stringify(envelope(TOOL, mode, null, [
      'SLACK_USER_TOKEN not set — see specs/04-slack.md for Slack app setup instructions'
    ])))
    return
  }

  const slack = new WebClient(token)

  try {
    const auth = await slack.auth.test()
    if (!auth.ok) {
      console.log(JSON.stringify(envelope(TOOL, mode, null, ['Slack auth failed — check SLACK_USER_TOKEN'])))
      return
    }

    const userId = auth.user_id
    // auth.url is the workspace URL e.g. "https://adobe.slack.com/" — used for permalink construction
    const workspaceUrl = auth.url || 'https://app.slack.com/'

    let data

    // --context <channel_id> <thread_ts> — fetch full thread for draft generation
    const ctxIdx = args.indexOf('--context')
    if (ctxIdx !== -1) {
      const channelId = args[ctxIdx + 1]
      const threadTs = args[ctxIdx + 2]
      if (!channelId || !threadTs) {
        console.log(JSON.stringify(envelope(TOOL, 'context', null, ['--context requires <channel_id> <thread_ts>'])))
        return
      }
      data = await runContext(slack, channelId, threadTs, workspaceUrl)
      console.log(JSON.stringify(envelope(TOOL, 'context', data)))
      return
    }

    if (mode === 'search') {
      if (!query) {
        console.log(JSON.stringify(envelope(TOOL, mode, null, ['--search requires a query string'])))
        return
      }
      data = await runSearch(slack, query)
    } else {
      data = await runBrief(slack, userId, lookbackHours, workspaceUrl)
    }

    console.log(JSON.stringify(envelope(TOOL, mode, data)))
  } catch (err) {
    console.error(`[${TOOL}]`, err.message)
    console.log(JSON.stringify(envelope(TOOL, mode, null, [err.message])))
  }
}

main()
