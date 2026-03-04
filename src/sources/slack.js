import 'dotenv/config'
import fs from 'fs/promises'
import { fileURLToPath } from 'url'
import { WebClient, LogLevel } from '@slack/web-api'
import { isMock, isSaveFixture, debug } from '../utils/flags.js'

const ALERT_KEYWORDS = /\b(incident|alert|failed|error|outage|down|critical|urgent|p1|p2)\b/i

// Rate limit delay between conversations.history calls (Tier 3: ~50/min)
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

// ---------------------------------------------------------------------------
// Config loading
// ---------------------------------------------------------------------------

/**
 * Fetches all public/private channels the user is a member of (paginated, called once).
 * Returns the raw channel objects so callers can extract what they need.
 * @param {WebClient} slack
 * @returns {Promise<object[]>}
 */
async function fetchMemberChannels(slack) {
  const allChannels = []
  let cursor
  let page = 0
  do {
    page++
    debug('[slack]', `users.conversations page ${page}...`)
    const resp = await slack.users.conversations({
      types: 'public_channel,private_channel',
      exclude_archived: true,
      limit: 1000,
      ...(cursor ? { cursor } : {}),
    })
    allChannels.push(...(resp.channels ?? []))
    debug('[slack]', `page ${page}: ${resp.channels?.length ?? 0} channels (${allChannels.length} total)`)
    cursor = resp.response_metadata?.next_cursor
  } while (cursor)
  return allChannels
}

/**
 * Loads Slack config from SLACK_CONFIG_PATH (default: config/slack.json).
 * Expects { "channels": ["#channel-one", "#channel-two", ...] }.
 * Resolves channel names to IDs using a pre-fetched channel list.
 * @param {object[]} memberChannels - From fetchMemberChannels()
 * @returns {Promise<{ ok: boolean, channels?: Array<{id: string, name: string}> }>}
 */
async function loadConfig(memberChannels) {
  const configPath = process.env.SLACK_CONFIG_PATH ?? './config/slack.json'

  let raw
  try {
    raw = await fs.readFile(configPath, 'utf-8')
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.error(`[slack] Config not found at ${configPath} — copy config/slack.example.json to ${configPath} and fill in`)
      return { ok: false }
    }
    console.warn(`[slack] Failed to read config: ${err.message}`)
    return { ok: false }
  }

  let config
  try {
    config = JSON.parse(raw)
  } catch {
    console.warn(`[slack] Config at ${configPath} is not valid JSON — skipping channel summaries`)
    return { ok: false }
  }

  const channelNames = config.channels
  if (!Array.isArray(channelNames) || channelNames.length === 0) {
    console.warn('[slack] No "channels" array in config — skipping channel summaries')
    return { ok: false }
  }

  const channelMap = new Map()
  for (const ch of memberChannels) {
    channelMap.set(ch.name.toLowerCase(), { id: ch.id, name: ch.name })
  }

  const channels = []
  for (const rawName of channelNames) {
    const normalized = rawName.replace(/^#/, '').toLowerCase()
    const resolved = channelMap.get(normalized)
    if (resolved) {
      channels.push(resolved)
    } else {
      console.warn(`[slack] Channel not found or not a member: ${rawName}`)
    }
  }

  return { ok: true, channels }
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
 * Resolves a list of raw Slack message objects into threadContext entries with
 * display names and resolved @-mention text. Used to build AI-readable context.
 * @param {WebClient} slack
 * @param {Map} userCache
 * @param {object[]} replies - Raw Slack message objects
 * @returns {Promise<Array<{ user: string, text: string }>>}
 */
async function buildThreadContext(slack, userCache, replies) {
  const context = []
  for (const r of replies) {
    const user = r.user
      ? await resolveUser(slack, userCache, r.user)
      : { id: 'bot', name: r.username ?? 'bot' }
    const text = await resolveText(slack, userCache, r.text ?? '')
    context.push({ user: user.name, text: text.slice(0, 150) })
  }
  return context
}

/**
 * Fetches messages mentioning the authenticated user via the search API.
 * For threaded mentions, checks if the user has already replied and has the last word.
 * If so, the mention is considered handled and filtered out.
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
        replyCount: msg.reply_count ?? 0,
        permalink: msg.permalink,
      })
    }

    // For threaded mentions: fetch thread replies to (a) drop fully-handled mentions and
    // (b) attach context so the AI can judge whether the thread is still open for the user.
    // Handles two cases:
    //   - thread reply: threadTs !== ts (user was mentioned in a reply)
    //   - thread root: threadTs === ts (user was mentioned in the opening message, which has replies)
    const filtered = []
    for (const mention of mentions) {
      const isThreadReply = mention.threadTs && mention.threadTs !== mention.ts
      const isThreadRoot = mention.threadTs && mention.threadTs === mention.ts && mention.replyCount > 0
      if (!isThreadReply && !isThreadRoot) {
        // Standalone message or root with no replies yet — include directly
        filtered.push(mention)
        continue
      }
      try {
        const threadResp = await slack.conversations.replies({
          channel: mention.channelId,
          ts: mention.threadTs,
          limit: 50,
        })
        const replies = (threadResp.messages ?? []).slice(1) // skip parent message
        const userReplies = replies.filter(m => m.user === userId && parseFloat(m.ts) > parseFloat(mention.ts))

        if (userReplies.length === 0) {
          // User hasn't replied since the mention — include with full reply context
          const raw = replies.slice(-5)
          const context = raw.length > 0 ? await buildThreadContext(slack, userCache, raw) : undefined
          filtered.push({ ...mention, threadContext: context })
          continue
        }

        const lastUserTs = Math.max(...userReplies.map(m => parseFloat(m.ts)))
        const repliesAfterUser = replies.filter(m => m.user !== userId && parseFloat(m.ts) > lastUserTs && !m.subtype)

        if (repliesAfterUser.length === 0) {
          // User has the last word — mention is handled, skip it
          continue
        }

        // Thread still active after user's reply — include with context of what happened after
        const context = await buildThreadContext(slack, userCache, repliesAfterUser.slice(0, 5))
        filtered.push({ ...mention, threadContext: context })
      } catch (err) {
        console.warn(`[slack] thread check failed ${mention.channelId}/${mention.threadTs}:`, err.message)
        filtered.push(mention) // include on error (safe default)
      }
    }
    debug('[slack]', `${filtered.length} mentions after filtering already-handled threads (${mentions.length - filtered.length} skipped)`)
    return filtered
  } catch (err) {
    console.warn('[slack] search.messages failed:', err.message)
    return []
  }
}

/**
 * Fetches threads the user has participated in that have new replies from others
 * since the user's last reply. Mirrors Slack's "Threads" sidebar.
 * @param {WebClient} slack
 * @param {Map} userCache
 * @param {string} userId
 * @param {Date} since
 * @returns {Promise<object[]>}
 */
async function fetchThreadUpdates(slack, userCache, userId, since) {
  // Find messages the user sent recently — those in threads are threads they participated in
  let userMessages
  try {
    const resp = await slack.search.messages({
      query: `from:<@${userId}>`,
      count: 100,
      sort: 'timestamp',
      sort_dir: 'desc',
    })
    userMessages = resp.messages?.matches ?? []
  } catch (err) {
    console.warn('[slack] thread updates search failed:', err.message)
    return []
  }

  // Collect unique threads the user participated in (replied to, not started)
  const sinceTs = since.getTime() / 1000
  const threadKeys = new Map() // `channelId:threadTs` → { channelId, channelName, threadTs }
  for (const msg of userMessages) {
    if (parseFloat(msg.ts) < sinceTs) continue
    // A thread reply has thread_ts set and different from its own ts
    if (!msg.thread_ts || msg.thread_ts === msg.ts) continue
    const key = `${msg.channel.id}:${msg.thread_ts}`
    if (!threadKeys.has(key)) {
      threadKeys.set(key, { channelId: msg.channel.id, channelName: msg.channel.name, threadTs: msg.thread_ts })
    }
  }

  const threadUpdates = []
  for (const { channelId, channelName, threadTs } of threadKeys.values()) {
    try {
      const resp = await slack.conversations.replies({ channel: channelId, ts: threadTs, limit: 50 })
      const allReplies = (resp.messages ?? []).slice(1) // skip parent message

      // Find the user's last reply in this thread
      const userReplies = allReplies.filter(m => m.user === userId)
      if (userReplies.length === 0) continue
      const lastUserReplyTs = Math.max(...userReplies.map(m => parseFloat(m.ts)))

      // Find replies from others AFTER the user's last reply
      const newReplies = allReplies.filter(
        m => m.user !== userId && parseFloat(m.ts) > lastUserReplyTs && !m.subtype
      )
      if (newReplies.length === 0) continue // user has the last word — nothing new to see

      const parentMsg = resp.messages?.[0]
      const parentText = await resolveText(slack, userCache, parentMsg?.text ?? '')

      const resolvedReplies = []
      for (const reply of newReplies.slice(0, 5)) {
        const user = await resolveUser(slack, userCache, reply.user)
        const text = await resolveText(slack, userCache, reply.text)
        resolvedReplies.push({ ts: reply.ts, user, text: text.slice(0, 200) })
      }

      threadUpdates.push({
        channelId,
        channelName,
        threadTs,
        parentText: parentText.slice(0, 200),
        newReplies: resolvedReplies,
        totalNewReplies: newReplies.length,
      })
    } catch (err) {
      console.warn(`[slack] thread fetch failed ${channelId}/${threadTs}:`, err.message)
    }
  }

  return threadUpdates
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
    let page = 0
    do {
      page++
      debug('[slack]', `DM users.conversations page ${page}...`)
      const resp = await slack.users.conversations({
        types: 'im,mpim',
        exclude_archived: true,
        limit: 1000,
        ...(cursor ? { cursor } : {}),
      })
      dmChannels.push(...(resp.channels ?? []))
      cursor = resp.response_metadata?.next_cursor
    } while (cursor)
    debug('[slack]', `Found ${dmChannels.length} DM conversations`)
  } catch (err) {
    console.warn('[slack] DM list failed:', err.message)
    return []
  }

  const sinceTs = String(since.getTime() / 1000)
  const sinceTsNum = parseFloat(sinceTs)

  // Pre-filter: skip DMs where the latest message is older than the lookback window
  const activeDMs = dmChannels.filter(dm => {
    if (!dm.latest || !dm.latest.ts) return false
    return parseFloat(dm.latest.ts) >= sinceTsNum
  })
  debug('[slack]', `${activeDMs.length} of ${dmChannels.length} DMs had activity since lookback`)

  const directMessages = []

  for (const dm of activeDMs) {
    try {
      const resp = await slack.conversations.history({ channel: dm.id, oldest: sinceTs, limit: 50 })
      const messages = (resp.messages ?? []).filter(m => !m.subtype || m.subtype === 'bot_message')
      // Only include DMs where someone else sent a message (they reached out)
      if (!messages.some(m => m.user !== myUserId)) continue

      let withUser = { id: 'group', name: 'Group DM' }
      if (dm.user && dm.user !== myUserId) {
        withUser = await resolveUser(slack, userCache, dm.user)
      }

      const resolvedMessages = []
      for (const msg of messages.slice(0, 10)) {
        const text = await resolveText(slack, userCache, msg.text)
        resolvedMessages.push({
          ts: msg.ts,
          isFromMe: msg.user === myUserId,
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
 * Filters out the authenticated user's own messages — sections are for awareness
 * of what's happening in the org, not a log of what the user already did.
 * @param {WebClient} slack
 * @param {Map} userCache
 * @param {{ id: string, name: string }} channel
 * @param {string} myUserId
 * @param {Date} since
 * @returns {Promise<object>}
 */
async function fetchChannelHistory(slack, userCache, channel, myUserId, since) {
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

      // Skip the user's own messages — they know what they said
      if (msg.user === myUserId) continue

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

    // Fetch replies for active threads (from others only)
    for (const threadTs of threads) {
      try {
        const threadResp = await slack.conversations.replies({
          channel: channel.id,
          ts: threadTs,
          oldest: sinceTs,
          limit: 20,
        })
        for (const reply of (threadResp.messages ?? []).slice(1)) {
          if (reply.subtype || reply.user === myUserId) continue
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
 * Fetches history for all priority channels with rate limiting.
 * @param {WebClient} slack
 * @param {Map} userCache
 * @param {Array<{id: string, name: string}>} channels
 * @param {string} myUserId
 * @param {Date} since
 * @returns {Promise<object[]>}
 */
async function fetchPriorityChannels(slack, userCache, channels, myUserId, since) {
  const result = []
  for (const channel of channels) {
    const channelData = await fetchChannelHistory(slack, userCache, channel, myUserId, since)
    result.push(channelData)
    await sleep(1200) // Tier 3 rate limit: ~50 req/min
  }
  return result
}

/**
 * Counts non-priority channels with unread messages from pre-fetched channel list.
 * @param {object[]} memberChannels - From fetchMemberChannels()
 * @param {Set<string>} priorityChannelIds
 * @returns {{ totalChannelsWithActivity: number, mentionCount: number }}
 */
function countOtherChannelActivity(memberChannels, priorityChannelIds) {
  let totalChannelsWithActivity = 0
  for (const ch of memberChannels) {
    if (priorityChannelIds.has(ch.id)) continue
    if ((ch.unread_count ?? 0) > 0) totalChannelsWithActivity++
  }
  return { totalChannelsWithActivity, mentionCount: 0 }
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Fetches Slack activity: mentions, thread updates, DMs, priority section channels,
 * and other channel summary.
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

  try {
    const slack = new WebClient(token, {
      logLevel: LogLevel.INFO,
      logger: {
        getLevel: () => LogLevel.INFO,
        setLevel: () => {},
        setName: () => {},
        debug: () => {},
        info: (...args) => {
          const msg = args.join(' ')
          if (msg.includes('rate limit')) {
            const retryMatch = msg.match(/retry in (\d+)/i)
            const secs = retryMatch ? retryMatch[1] : '?'
            debug('[slack]', `Rate limited — retrying in ${secs}s`)
          }
        },
        warn: () => {},
        error: (...args) => console.error('[slack:sdk]', ...args),
      },
    })
    const userCache = new Map()

    let userId
    let workspaceUrl = ''
    try {
      const auth = await slack.auth.test()
      userId = auth.user_id
      workspaceUrl = auth.url ?? ''
    } catch (err) {
      if (err.data?.error === 'invalid_auth') return { ok: false, error: 'Slack auth failed — check SLACK_USER_TOKEN' }
      return { ok: false, error: `Slack auth failed: ${err.message}` }
    }

    // Fetch all member channels once — reused by loadConfig and countOtherChannelActivity
    console.log('[slack] Fetching channel list...')
    const memberChannels = await fetchMemberChannels(slack)
    console.log(`[slack] Found ${memberChannels.length} member channels`)

    const config = await loadConfig(memberChannels)
    const priorityChannels = config.ok ? config.channels : []
    const priorityChannelIds = new Set(priorityChannels.map(ch => ch.id))

    debug('[slack]', 'Fetching mentions...')
    const mentions = await fetchMentions(slack, userCache, userId, since)
    debug('[slack]', `${mentions.length} mentions found`)

    debug('[slack]', 'Fetching thread updates...')
    const threadUpdates = await fetchThreadUpdates(slack, userCache, userId, since)
    debug('[slack]', `${threadUpdates.length} thread updates found`)

    debug('[slack]', 'Fetching DMs...')
    const directMessages = await fetchDirectMessages(slack, userCache, userId, since)
    debug('[slack]', `${directMessages.length} DM conversations with activity`)

    debug('[slack]', `Fetching history for ${priorityChannels.length} priority channels...`)
    const channelData = await fetchPriorityChannels(slack, userCache, priorityChannels, userId, since)

    const otherChannelsActivity = countOtherChannelActivity(memberChannels, priorityChannelIds)
    debug('[slack]', `${otherChannelsActivity.totalChannelsWithActivity} other channels with activity`)

    return { ok: true, data: { mentions, threadUpdates, directMessages, channels: channelData, otherChannelsActivity, workspaceUrl } }
  } catch (err) {
    console.error('[slack] fetch failed:', err.message)
    return { ok: false, error: err.message }
  }
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
