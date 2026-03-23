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

  // Divider + draft
  parts.push('\n---')
  parts.push(input.draft || '_No draft text provided_')
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
