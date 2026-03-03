import 'dotenv/config'
import fs from 'fs/promises'
import { fileURLToPath } from 'url'
import { WebClient } from '@slack/web-api'
import { isMock, isSaveFixture } from '../utils/flags.js'

const ALERT_KEYWORDS = /\b(incident|alert|failed|error|outage|down|critical|urgent|p1|p2)\b/i

// Rate limit delay between conversations.history calls (Tier 3: ~50/min)
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

// ---------------------------------------------------------------------------
// Config loading
// ---------------------------------------------------------------------------

/**
 * Loads slack-sections.json and resolves channel names to IDs via conversations.list.
 * Returns { ok: false } without error if the file is simply missing.
 * @param {WebClient} slack
 * @returns {Promise<{ ok: boolean, sections?: object }>}
 */
async function loadSectionsConfig(slack) {
  const configPath = process.env.SLACK_SECTIONS_CONFIG ?? './slack-sections.json'

  let raw
  try {
    raw = await fs.readFile(configPath, 'utf-8')
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.warn(`[slack] sections config not found at ${configPath} — skipping section summaries`)
      return { ok: false }
    }
    console.warn(`[slack] Failed to read sections config: ${err.message}`)
    return { ok: false }
  }

  let sectionDefs
  try {
    sectionDefs = JSON.parse(raw)
  } catch {
    console.warn('[slack] sections config is not valid JSON — skipping section summaries')
    return { ok: false }
  }

  // Build name→{id,name} map from all member channels
  const channelMap = new Map()
  let cursor
  do {
    const resp = await slack.conversations.list({
      types: 'public_channel,private_channel',
      exclude_archived: true,
      limit: 200,
      ...(cursor ? { cursor } : {}),
    })
    for (const ch of resp.channels ?? []) {
      if (ch.is_member) channelMap.set(ch.name.toLowerCase(), { id: ch.id, name: ch.name })
    }
    cursor = resp.response_metadata?.next_cursor
  } while (cursor)

  const sections = {}
  for (const [sectionName, channelNames] of Object.entries(sectionDefs)) {
    sections[sectionName] = []
    for (const rawName of channelNames) {
      const normalized = rawName.replace(/^#/, '').toLowerCase()
      const resolved = channelMap.get(normalized)
      if (resolved) {
        sections[sectionName].push(resolved)
      } else {
        console.warn(`[slack] Channel not found or not a member: ${rawName}`)
      }
    }
  }

  return { ok: true, sections, channelMap }
}

// ---------------------------------------------------------------------------
// User resolution
// ---------------------------------------------------------------------------

/**
 * Resolves a Slack user ID to a display name (cached).
 * @param {WebClient} slack
 * @param {Map} cache
 * @param {string} userId
 * @returns {Promise<{ id: string, name: string }>}
 */
async function resolveUser(slack, cache, userId) {
  if (cache.has(userId)) return cache.get(userId)
  try {
    const { user } = await slack.users.info({ user: userId })
    const resolved = { id: userId, name: user.profile?.display_name || user.real_name || userId }
    cache.set(userId, resolved)
    return resolved
  } catch {
    const fallback = { id: userId, name: userId }
    cache.set(userId, fallback)
    return fallback
  }
}

/**
 * Replaces Slack <@UXXXXXX> user mentions with display names.
 * @param {WebClient} slack
 * @param {Map} userCache
 * @param {string} text
 * @returns {Promise<string>}
 */
async function resolveText(slack, userCache, text) {
  if (!text) return ''
  const matches = [...text.matchAll(/<@(U[A-Z0-9]+)>/g)]
  let resolved = text
  for (const [full, userId] of matches) {
    const user = await resolveUser(slack, userCache, userId)
    resolved = resolved.replace(full, `@${user.name}`)
  }
  return resolved
}

// ---------------------------------------------------------------------------
// Fetchers
// ---------------------------------------------------------------------------

/**
 * Fetches messages mentioning the authenticated user via the search API.
 * @param {WebClient} slack
 * @param {Map} userCache
 * @param {string} userId
 * @param {Date} since
 * @returns {Promise<object[]>}
 */
async function fetchMentions(slack, userCache, userId, since) {
  try {
    const resp = await slack.search.messages({
      query: `<@${userId}>`,
      count: 100,
      sort: 'timestamp',
      sort_dir: 'desc',
    })
    const sinceTs = since.getTime() / 1000
    const mentions = []
    for (const msg of resp.messages?.matches ?? []) {
      if (parseFloat(msg.ts) < sinceTs) break
      const user = msg.user ? await resolveUser(slack, userCache, msg.user) : { id: 'bot', name: msg.username ?? 'bot' }
      const text = await resolveText(slack, userCache, msg.text)
      mentions.push({
        channelId: msg.channel?.id,
        channelName: msg.channel?.name,
        ts: msg.ts,
        user,
        text: text.slice(0, 300),
        threadTs: msg.thread_ts ?? null,
        permalink: msg.permalink,
      })
    }
    return mentions
  } catch (err) {
    console.warn('[slack] search.messages failed:', err.message)
    return []
  }
}

/**
 * Fetches direct messages (1:1 and group DMs) with activity since `since`.
 * @param {WebClient} slack
 * @param {Map} userCache
 * @param {string} myUserId
 * @param {Date} since
 * @returns {Promise<object[]>}
 */
async function fetchDirectMessages(slack, userCache, myUserId, since) {
  let dmChannels = []
  try {
    let cursor
    do {
      const resp = await slack.conversations.list({
        types: 'im,mpim',
        exclude_archived: true,
        limit: 200,
        ...(cursor ? { cursor } : {}),
      })
      dmChannels.push(...(resp.channels ?? []))
      cursor = resp.response_metadata?.next_cursor
    } while (cursor)
  } catch (err) {
    console.warn('[slack] DM list failed:', err.message)
    return []
  }

  const sinceTs = String(since.getTime() / 1000)
  const directMessages = []

  for (const dm of dmChannels) {
    try {
      const resp = await slack.conversations.history({ channel: dm.id, oldest: sinceTs, limit: 50 })
      const messages = (resp.messages ?? []).filter(m => !m.subtype || m.subtype === 'bot_message')
      if (messages.length === 0) continue

      let withUser = { id: 'group', name: 'Group DM' }
      if (dm.user && dm.user !== myUserId) {
        withUser = await resolveUser(slack, userCache, dm.user)
      }

      const resolvedMessages = []
      for (const msg of messages.slice(0, 10)) {
        const text = await resolveText(slack, userCache, msg.text)
        resolvedMessages.push({
          ts: msg.ts,
          user: msg.user ? await resolveUser(slack, userCache, msg.user) : null,
          text: text.slice(0, 200),
        })
      }

      directMessages.push({ dmId: dm.id, withUser, messages: resolvedMessages })
    } catch (err) {
      console.warn(`[slack] DM history failed for ${dm.id}:`, err.message)
    }
  }

  return directMessages
}

/**
 * Returns true if a bot message contains alert-worthy keywords.
 * @param {object} msg
 * @returns {boolean}
 */
function isBotMessageWorthIncluding(msg) {
  const text = msg.text ?? ''
  const attachText = (msg.attachments ?? []).map(a => a.text ?? '').join(' ')
  return ALERT_KEYWORDS.test(text) || ALERT_KEYWORDS.test(attachText)
}

/**
 * Fetches full history for a single priority channel.
 * @param {WebClient} slack
 * @param {Map} userCache
 * @param {{ id: string, name: string }} channel
 * @param {Date} since
 * @returns {Promise<object>}
 */
async function fetchChannelHistory(slack, userCache, channel, since) {
  const sinceTs = String(since.getTime() / 1000)
  const messages = []
  const threadReplies = []

  try {
    const resp = await slack.conversations.history({ channel: channel.id, oldest: sinceTs, limit: 200 })
    const threads = new Set()

    for (const msg of resp.messages ?? []) {
      if (msg.subtype === 'bot_message') {
        if (!isBotMessageWorthIncluding(msg)) continue
      } else if (msg.subtype) {
        continue // skip channel_join, channel_leave, etc.
      }

      const user = msg.user
        ? await resolveUser(slack, userCache, msg.user)
        : { id: 'bot', name: msg.username ?? 'bot' }
      const text = await resolveText(slack, userCache, msg.text)

      messages.push({
        ts: msg.ts,
        user,
        text: text.slice(0, 300),
        replyCount: msg.reply_count ?? 0,
        reactions: (msg.reactions ?? []).map(r => ({ name: r.name, count: r.count })),
      })

      if ((msg.reply_count ?? 0) > 0 && msg.thread_ts) threads.add(msg.thread_ts)
    }

    // Fetch replies for active threads
    for (const threadTs of threads) {
      try {
        const threadResp = await slack.conversations.replies({
          channel: channel.id,
          ts: threadTs,
          oldest: sinceTs,
          limit: 20,
        })
        for (const reply of (threadResp.messages ?? []).slice(1)) {
          if (reply.subtype) continue
          const user = await resolveUser(slack, userCache, reply.user)
          const text = await resolveText(slack, userCache, reply.text)
          threadReplies.push({ ts: reply.ts, threadTs, user, text: text.slice(0, 200) })
        }
      } catch (err) {
        console.warn(`[slack] thread replies failed ${channel.name}/${threadTs}:`, err.message)
      }
    }
  } catch (err) {
    const errCode = err.data?.error
    if (errCode === 'channel_not_found' || errCode === 'not_in_channel') {
      console.warn(`[slack] Not a member of #${channel.name} — skipping`)
    } else {
      console.warn(`[slack] History failed for #${channel.name}:`, err.message)
    }
  }

  return { ...channel, messages, threadReplies }
}

/**
 * Fetches history for all priority section channels with rate limiting.
 * @param {WebClient} slack
 * @param {Map} userCache
 * @param {object} sections - { sectionName: [{ id, name }] }
 * @param {Date} since
 * @returns {Promise<object>} - { sectionName: { channels: [...] } }
 */
async function fetchSections(slack, userCache, sections, since) {
  const result = {}
  for (const [sectionName, channels] of Object.entries(sections)) {
    result[sectionName] = { channels: [] }
    for (const channel of channels) {
      const channelData = await fetchChannelHistory(slack, userCache, channel, since)
      result[sectionName].channels.push(channelData)
      await sleep(1200) // Tier 3 rate limit: ~50 req/min
    }
  }
  return result
}

/**
 * Counts non-priority channels with unread messages (via conversations.list unread_count).
 * @param {WebClient} slack
 * @param {Set<string>} priorityChannelIds
 * @returns {Promise<{ totalChannelsWithActivity: number, mentionCount: number }>}
 */
async function countOtherChannelActivity(slack, priorityChannelIds) {
  let totalChannelsWithActivity = 0
  try {
    let cursor
    do {
      const resp = await slack.conversations.list({
        types: 'public_channel,private_channel',
        exclude_archived: true,
        limit: 200,
        ...(cursor ? { cursor } : {}),
      })
      for (const ch of resp.channels ?? []) {
        if (!ch.is_member || priorityChannelIds.has(ch.id)) continue
        if ((ch.unread_count ?? 0) > 0) totalChannelsWithActivity++
      }
      cursor = resp.response_metadata?.next_cursor
    } while (cursor)
  } catch (err) {
    console.warn('[slack] Could not count other channel activity:', err.message)
  }
  return { totalChannelsWithActivity, mentionCount: 0 }
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Fetches Slack activity: mentions, DMs, priority section channels, and other channel summary.
 * @param {Date} since - Lookback start time
 * @returns {Promise<{ ok: boolean, data?: object, error?: string }>}
 */
export async function fetchSlack(since) {
  if (isMock) {
    try {
      const fixture = JSON.parse(await fs.readFile('tests/fixtures/slack.json', 'utf-8'))
      return fixture
    } catch {
      return { ok: false, error: 'Mock fixture not found: tests/fixtures/slack.json' }
    }
  }

  const token = process.env.SLACK_USER_TOKEN
  if (!token) return { ok: false, error: 'Slack token missing — check SLACK_USER_TOKEN in .env' }

  const slack = new WebClient(token)
  const userCache = new Map()

  let userId
  try {
    const auth = await slack.auth.test()
    userId = auth.user_id
  } catch (err) {
    if (err.data?.error === 'invalid_auth') return { ok: false, error: 'Slack auth failed — check SLACK_USER_TOKEN' }
    return { ok: false, error: `Slack auth failed: ${err.message}` }
  }

  // Load sections config — non-fatal if missing
  const sectionsConfig = await loadSectionsConfig(slack)
  const sections = sectionsConfig.ok ? sectionsConfig.sections : {}
  const priorityChannelIds = new Set(Object.values(sections).flatMap(chs => chs.map(ch => ch.id)))

  const mentions = await fetchMentions(slack, userCache, userId, since)
  const directMessages = await fetchDirectMessages(slack, userCache, userId, since)
  const sectionData = await fetchSections(slack, userCache, sections, since)
  const otherChannelsActivity = await countOtherChannelActivity(slack, priorityChannelIds)

  return { ok: true, data: { mentions, directMessages, sections: sectionData, otherChannelsActivity } }
}

// Standalone runner
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const result = await fetchSlack(since)
  console.log(JSON.stringify(result, null, 2))

  if (isSaveFixture) {
    await fs.writeFile('tests/fixtures/slack.json', JSON.stringify(result, null, 2))
    console.log('[slack] Fixture saved to tests/fixtures/slack.json')
  }
}
