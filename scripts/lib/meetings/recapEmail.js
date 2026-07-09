/**
 * Recap-email discovery — search Graph for emails containing meeting
 * notes/recaps, and fetch their full body text.
 *
 * Extracted from scripts/summarize-meeting.js (slice 006-01) so both
 * scripts/summarize-meeting.js and scripts/fetch-outlook.js can share the
 * same discovery logic without duplicating it.
 */

import { graphFetch, graphPost } from '../graphAuth.js'

const GRAPH = 'https://graph.microsoft.com/v1.0'

/**
 * Search for emails that contain meeting notes/recaps using Graph search API.
 * @param {string} token
 * @param {string[]} keywords - Subject keywords to match
 * @param {number} lookbackHours
 * @returns {Promise<object[]>}
 */
export async function findMeetingRecapEmails(token, keywords, lookbackHours = 48) {
  const since = new Date(Date.now() - lookbackHours * 3600_000).toISOString().slice(0, 10)
  // Build KQL query: subject contains any keyword AND received recently
  // Use individual words (not exact phrases) so "Meeting Recoding and Notes" matches "meeting notes"
  const subjectClauses = keywords.map(k => {
    const words = k.split(/\s+/).filter(w => w.length > 2)
    return `(${words.map(w => `subject:${w}`).join(' AND ')})`
  }).join(' OR ')
  const queryString = `(${subjectClauses}) AND received>=${since}`

  console.error(`[meeting] Searching recap emails: ${queryString}`)

  const result = await graphPost(token, `${GRAPH}/search/query`, {
    requests: [{
      entityTypes: ['message'],
      query: { queryString },
      from: 0,
      size: 20,
    }],
  })

  const hits = result.value?.[0]?.hitsContainers?.[0]?.hits ?? []
  return hits.map(hit => ({
    id: hit.hitId ?? hit.resource?.id ?? '',
    subject: hit.resource?.subject ?? '',
    from: hit.resource?.from?.emailAddress?.name ?? hit.resource?.sender?.emailAddress?.name ?? '',
    fromEmail: hit.resource?.from?.emailAddress?.address ?? '',
    receivedAt: hit.resource?.receivedDateTime ?? '',
    webLink: hit.resource?.webLink ?? '',
    summary: (hit.summary ?? '').replace(/<[^>]+>/g, '').slice(0, 200),
  }))
}

/**
 * Fetch the full body of an email, returning plain text.
 * @param {string} token
 * @param {string} messageId
 * @returns {Promise<string>}
 */
export async function fetchEmailBody(token, messageId) {
  const msg = await graphFetch(token,
    `${GRAPH}/me/messages/${messageId}?$select=body,from,toRecipients,ccRecipients`)
  const html = msg.body?.content ?? ''
  // Strip HTML to plain text
  const bodyText = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#\d+;/g, '')
    .replace(/\s+/g, ' ').trim()

  // Prepend sender/recipient info so Claude can detect attendees and companies
  const fmt = (r) => `${r.emailAddress?.name ?? ''} <${r.emailAddress?.address ?? ''}>`
  const from = msg.from ? fmt(msg.from) : ''
  const to = (msg.toRecipients || []).map(fmt).join(', ')
  const cc = (msg.ccRecipients || []).map(fmt).join(', ')
  const header = [
    from && `From: ${from}`,
    to && `To: ${to}`,
    cc && `CC: ${cc}`,
  ].filter(Boolean).join('\n')

  return header ? `${header}\n\n${bodyText}` : bodyText
}
