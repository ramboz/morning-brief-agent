#!/usr/bin/env node

/**
 * stage-slack-draft.js — Post a draft reply to the user's own DM channel.
 *
 * Usage:
 *   echo '{"channel":"#contextual-exp-team","permalink":"https://...","summary":"...","draft":"..."}' | node scripts/stage-slack-draft.js
 *
 * Reads a JSON object from stdin with:
 *   - channel:   Target channel name (for display only)
 *   - permalink: Link to the original message being replied to
 *   - summary:   One-line summary of what the original message asked
 *   - draft:     The draft reply text (in Slack mrkdwn format)
 *   - target:    Who the reply is directed at (e.g. "@gillies")
 *   - mentions:  Optional map of display names to Slack user IDs for proper @-mentions
 *                e.g. {"@gillies": "W5LSJ5HN0", "@ftathagat": "U08E9QMRZV3"}
 *                Names in the draft text will be replaced with <@USER_ID> so they
 *                become real mentions when copy-pasted into the target channel.
 *
 * Posts a formatted draft message to the authenticated user's own DM (self-chat).
 * The user reviews, then copies the draft text to the target channel.
 *
 * Standalone: echo '{"draft":"test"}' | node scripts/stage-slack-draft.js
 * Reference:  docs/decisions/ADR-002-draft-generation-and-delivery.md
 */

import dotenv from 'dotenv'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebClient } from '@slack/web-api'
import { envelope } from './lib/config.js'

dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), '.env') })

const TOOL = 'slack_draft'

/**
 * Read all of stdin as a string.
 * @returns {Promise<string>}
 */
async function readStdin() {
  const chunks = []
  for await (const chunk of process.stdin) {
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf-8')
}

/**
 * Find the user's self-DM channel (conversation with themselves).
 * @param {WebClient} slack
 * @param {string} userId
 * @returns {Promise<string>} Channel ID for self-DM
 */
async function findSelfDm(slack, userId) {
  // Open a DM with yourself — Slack API handles this idempotently
  const res = await slack.conversations.open({ users: userId })
  if (!res.channel?.id) {
    throw new Error('Could not open self-DM channel')
  }
  return res.channel.id
}

/**
 * Replace @name references in text with proper Slack <@USER_ID> mentions.
 * @param {string} text - Draft text
 * @param {object} mentions - Map of display names to user IDs, e.g. {"@gillies": "W5LSJ5HN0"}
 * @returns {string} Text with proper mention markup
 */
function applyMentions(text, mentions) {
  if (!mentions || typeof mentions !== 'object') return text
  let result = text
  for (const [name, userId] of Object.entries(mentions)) {
    if (!userId) continue
    // Replace both "@name" and "name" variants (case-insensitive)
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    result = result.replace(new RegExp(escapedName, 'gi'), `<@${userId}>`)
    // Also handle without @ prefix
    const bare = name.replace(/^@/, '')
    if (bare !== name) {
      const escapedBare = bare.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      result = result.replace(new RegExp(`@${escapedBare}`, 'gi'), `<@${userId}>`)
    }
  }
  return result
}

/**
 * Format a draft message for the self-DM channel.
 * @param {object} input - Draft input from stdin
 * @returns {string} Formatted Slack mrkdwn message
 */
function formatDraftMessage(input) {
  const parts = []

  // Header
  const channelLabel = input.channel || 'unknown channel'
  const target = input.target || ''
  const header = target
    ? `💬 *Draft reply for ${channelLabel}* → ${target}`
    : `💬 *Draft reply for ${channelLabel}*`
  parts.push(header)

  // Link to original
  if (input.permalink) {
    parts.push(`<${input.permalink}|View original message>`)
  }

  // Context summary
  if (input.summary) {
    parts.push(`\n> ${input.summary}`)
  }

  // Apply mention replacements to draft text
  const draftText = applyMentions(input.draft || '_No draft text provided_', input.mentions)

  // Divider + draft
  parts.push('\n---')
  parts.push(draftText)
  parts.push('---')

  // Footer
  parts.push('_Auto-drafted by Morning Assistant · Review before pasting_')

  return parts.join('\n')
}

async function main() {
  const token = process.env.SLACK_USER_TOKEN
  if (!token) {
    console.log(JSON.stringify(envelope(TOOL, 'draft', null, ['SLACK_USER_TOKEN not set'])))
    return
  }

  // Read draft input from stdin
  let input
  try {
    const raw = await readStdin()
    input = JSON.parse(raw)
  } catch (err) {
    console.log(JSON.stringify(envelope(TOOL, 'draft', null, [
      `Invalid JSON on stdin: ${err.message}. Expected: {"channel":"#foo","permalink":"...","summary":"...","draft":"..."}`
    ])))
    return
  }

  if (!input.draft) {
    console.log(JSON.stringify(envelope(TOOL, 'draft', null, ['Missing "draft" field in input'])))
    return
  }

  const slack = new WebClient(token)

  try {
    const auth = await slack.auth.test()
    if (!auth.ok) {
      console.log(JSON.stringify(envelope(TOOL, 'draft', null, ['Slack auth failed'])))
      return
    }

    const userId = auth.user_id
    const selfDmId = await findSelfDm(slack, userId)

    const text = formatDraftMessage(input)

    const result = await slack.chat.postMessage({
      channel: selfDmId,
      text,
      mrkdwn: true,
      unfurl_links: false,
      unfurl_media: false
    })

    // Mark the self-DM as unread by rewinding the read cursor to just before
    // our message. This gives the user a notification badge in the Slack app.
    try {
      // Use a timestamp slightly before our message (subtract 1 microsecond)
      const parts = result.ts.split('.')
      const beforeTs = `${parts[0]}.${String(parseInt(parts[1], 10) - 1).padStart(6, '0')}`
      await slack.conversations.mark({ channel: selfDmId, ts: beforeTs })
      console.error(`[${TOOL}] Marked self-DM as unread`)
    } catch (markErr) {
      // Non-fatal — draft is still posted, just won't show unread badge
      console.error(`[${TOOL}] Could not mark as unread: ${markErr.message}`)
    }

    const workspaceUrl = auth.url || 'https://app.slack.com/'
    const draftPermalink = `${workspaceUrl}archives/${selfDmId}/p${result.ts.replace('.', '')}`

    console.log(JSON.stringify(envelope(TOOL, 'draft', {
      posted: true,
      selfDmId,
      ts: result.ts,
      permalink: draftPermalink,
      channel: input.channel || '',
      target: input.target || ''
    })))
  } catch (err) {
    console.error(`[${TOOL}]`, err.message)
    console.log(JSON.stringify(envelope(TOOL, 'draft', null, [err.message])))
  }
}

main()
