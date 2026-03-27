#!/usr/bin/env node

/**
 * fetch-outlook.js — Microsoft Graph API → JSON
 *
 * Fetches emails, calendar events, and Teams meeting transcripts via Graph API.
 * Uses OAuth2 PKCE flow (browser sign-in on first run, then cached/refreshed).
 *
 * Modes:
 *   --brief              Lookback scan: inbox emails, today's calendar, recent transcripts
 *   --search "query"     Deep Dive: search emails and files by keyword
 *
 * Standalone: node scripts/fetch-outlook.js --brief
 * Diagnostics: node scripts/diag-outlook.js
 */

import dotenv from 'dotenv'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs, loadConfig, envelope } from './lib/config.js'
import { getGraphToken, graphFetch, graphPost } from './lib/graphAuth.js'

dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), '..', '.env') })

const TOOL = 'outlook'
const MAX_EMAILS = 50
const MAX_SEARCH_RESULTS = 25
const EMAIL_PREVIEW_CHARS = 300
const GRAPH = 'https://graph.microsoft.com/v1.0'

// ── Triage logic ─────────────────────────────────────────────────────────────

/**
 * Triage an email into a category based on config rules and email metadata.
 * @param {object} msg - Graph API message object
 * @param {object} rules - Triage rules from config
 * @param {string} myEmail - Current user's email address
 * @returns {'action_required'|'fyi'|'newsletter'|'marketing'|'automated_alert'|'junk'}
 */
function triageEmail(msg, rules, myEmail) {
  const from = msg.from?.emailAddress?.address?.toLowerCase() ?? ''
  const subject = (msg.subject ?? '').toLowerCase()
  const preview = (msg.bodyPreview ?? '').toLowerCase()
  const combined = `${subject} ${preview}`

  // Check alert senders first (highest signal)
  if (rules.alert_senders?.some(s => from.includes(s.toLowerCase()))) {
    return 'automated_alert'
  }

  // Newsletter keywords
  if (rules.newsletter_keywords?.some(kw => combined.includes(kw.toLowerCase()))) {
    return 'newsletter'
  }

  // Marketing keywords
  if (rules.marketing_keywords?.some(kw => combined.includes(kw.toLowerCase()))) {
    return 'marketing'
  }

  // Noreply / automated senders
  if (from.includes('noreply') || from.includes('no-reply') || from.includes('mailer-daemon')
    || from.includes('notifications@github.com') || from.includes('notify@')
    || from.includes('notification@') || from.includes('builds@')
    || from.includes('jenkins@') || from.includes('jira@')
    || from.includes('confluence@') || from.includes('bitbucket@')) {
    return 'automated_alert'
  }

  // Action required: user is in TO (not just CC) and importance is high
  const inTo = msg.toRecipients?.some(
    r => r.emailAddress?.address?.toLowerCase() === myEmail.toLowerCase()
  )
  if (inTo && msg.importance === 'high') {
    return 'action_required'
  }

  // Action required: flagged by sender
  if (msg.flag?.flagStatus === 'flagged') {
    return 'action_required'
  }

  // If user is in TO, default to fyi (could be action_required but we're conservative)
  if (inTo) {
    return 'fyi'
  }

  // CC-only → fyi
  return 'fyi'
}

// ── Email helpers ────────────────────────────────────────────────────────────

/**
 * Build Outlook Web App URL for a message.
 * @param {string} messageId
 * @returns {string}
 */
function mailUrl(messageId) {
  return `https://outlook.office.com/mail/inbox/id/${encodeURIComponent(messageId)}`
}

/**
 * Map a Graph API message to our output format.
 * @param {object} msg - Graph message object
 * @param {object} rules - Triage rules
 * @param {string} myEmail
 * @returns {object}
 */
function mapEmail(msg, rules, myEmail) {
  // sender.name often has the real person (e.g. for GitHub notifications)
  const fromName = msg.from?.emailAddress?.name ?? ''
  const senderName = msg.sender?.emailAddress?.name ?? ''
  return {
    id: msg.id,
    from: {
      name: fromName,
      email: msg.from?.emailAddress?.address ?? '',
      senderName: senderName !== fromName ? senderName : undefined,
    },
    to: (msg.toRecipients ?? []).map(r => ({
      name: r.emailAddress?.name ?? '',
      email: r.emailAddress?.address ?? '',
    })),
    cc: (msg.ccRecipients ?? []).map(r => ({
      name: r.emailAddress?.name ?? '',
      email: r.emailAddress?.address ?? '',
    })),
    subject: msg.subject ?? '(no subject)',
    preview: (msg.bodyPreview ?? '').slice(0, EMAIL_PREVIEW_CHARS),
    receivedAt: msg.receivedDateTime,
    isRead: msg.isRead ?? false,
    importance: msg.importance ?? 'normal',
    hasAttachments: msg.hasAttachments ?? false,
    triage: triageEmail(msg, rules, myEmail),
    url: mailUrl(msg.id),
  }
}

// ── Calendar helpers ─────────────────────────────────────────────────────────

/**
 * Convert a UTC datetime string to local time in the given IANA timezone.
 * Returns an ISO-like string (YYYY-MM-DDTHH:MM:SS) in local time.
 * @param {string} utcDatetime - UTC datetime from Graph API (e.g. "2026-03-26T14:00:00.0000000")
 * @param {string} timezone - IANA timezone (e.g. "Europe/Paris")
 * @returns {string} Local datetime string
 */
function toLocalTime(utcDatetime, timezone) {
  if (!utcDatetime || !timezone) return utcDatetime
  try {
    // Graph API returns datetime without Z suffix but it's UTC
    const dt = utcDatetime.endsWith('Z') ? utcDatetime : utcDatetime + 'Z'
    const date = new Date(dt)
    // Format in the target timezone
    const parts = new Intl.DateTimeFormat('sv-SE', {
      timeZone: timezone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    }).formatToParts(date)
    const get = (type) => parts.find(p => p.type === type)?.value ?? ''
    return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}`
  } catch {
    return utcDatetime
  }
}

/**
 * Map a Graph calendar event to our output format.
 * @param {object} evt - Graph event object
 * @param {string} [timezone] - IANA timezone for local time conversion
 * @returns {object}
 */
function mapEvent(evt, timezone) {
  const start = timezone ? toLocalTime(evt.start?.dateTime, timezone) : evt.start?.dateTime
  const end = timezone ? toLocalTime(evt.end?.dateTime, timezone) : evt.end?.dateTime
  return {
    id: evt.id,
    subject: evt.subject ?? '(no subject)',
    start,
    end,
    timeZone: timezone || evt.start?.timeZone || 'UTC',
    isOnlineMeeting: evt.isOnlineMeeting ?? false,
    onlineMeetingUrl: evt.onlineMeetingUrl || null,
    organizer: {
      name: evt.organizer?.emailAddress?.name ?? '',
      email: evt.organizer?.emailAddress?.address ?? '',
    },
    location: evt.location?.displayName || null,
    isAllDay: evt.isAllDay ?? false,
    isCancelled: evt.isCancelled ?? false,
  }
}

// ── Transcript / recording helpers ───────────────────────────────────────────

/**
 * Search SharePoint for MP4 recordings matching a list of meeting subjects.
 * Used as a fallback when VTT transcripts are not accessible (attendee, not organizer).
 * @param {string} token
 * @param {string[]} subjects - Meeting subject lines from yesterday's calendar
 * @param {number} lookbackHours
 * @returns {Promise<object[]>}
 */
async function searchRecordings(token, subjects, lookbackHours) {
  if (!subjects.length) return []
  const cutoff = new Date(Date.now() - lookbackHours * 60 * 60 * 1000)
  const results = []
  /** @type {Map<string, string>} driveId → drive root server-relative path (e.g. /personal/jsuh_adobe_com/Documents) */
  const drivePathCache = new Map()

  for (const subject of subjects) {
    // Use the first ~40 chars of the subject as the search term
    const term = subject.slice(0, 40).replace(/['"]/g, '')
    try {
      const r = await graphPost(token, `${GRAPH}/search/query`, {
        requests: [{ entityTypes: ['driveItem'], query: { queryString: `"${term}" filetype:mp4` }, from: 0, size: 3 }],
      })
      const hits = r.value?.[0]?.hitsContainers?.[0]?.hits ?? []
      for (const hit of hits) {
        const res = hit.resource
        if (!res?.lastModifiedDateTime || new Date(res.lastModifiedDateTime) < cutoff) continue
        // Only include files that look like Teams recordings (name contains subject words)
        if (!res.name?.toLowerCase().includes(term.split(/\s+/)[0].toLowerCase())) continue

        // Construct proper Teams stream URL from drive webUrl + file path
        const driveId = res.parentReference?.driveId ?? ''
        let streamUrl = res.webUrl ?? '' // fallback
        if (driveId) {
          try {
            if (!drivePathCache.has(driveId)) {
              const driveInfo = await graphFetch(token, `${GRAPH}/drives/${driveId}?$select=webUrl`)
              // driveInfo.webUrl = https://adobe-my.sharepoint.com/personal/jsuh_adobe_com/Documents
              drivePathCache.set(driveId, driveInfo.webUrl ?? '')
            }
            const driveWebUrl = drivePathCache.get(driveId) ?? ''
            if (driveWebUrl) {
              // server-relative path = pathname of drive webUrl + relative path within drive + filename
              // Note: search results don't include path in parentReference, so fetch the item to get it.
              const driveRootPath = new URL(driveWebUrl).pathname  // /personal/jsuh_adobe_com/Documents
              let relPath = ''
              try {
                const itemInfo = await graphFetch(token, `${GRAPH}/drives/${driveId}/items/${res.id}?$select=parentReference`)
                relPath = (itemInfo.parentReference?.path ?? '').replace(/^.+root:/, '')  // /Recordings
              } catch (_) { /* fall through — path will be missing but URL still works */ }
              const serverPath = driveRootPath + relPath + '/' + res.name
              const siteBase = driveWebUrl.replace(/\/Documents$/, '')
              streamUrl = `${siteBase}/_layouts/15/stream.aspx?id=${encodeURIComponent(serverPath)}`
            }
          } catch (e) {
            console.error(`[outlook] Drive fetch failed for ${driveId}:`, e.message)
          }
        }

        results.push({
          subject,
          name: res.name ?? '',
          recordedAt: res.lastModifiedDateTime ?? '',
          webUrl: streamUrl,
          organizer: res.createdBy?.user?.displayName ?? '',
          driveId,
          parentId: res.parentReference?.id ?? '',
        })
        break // one recording per meeting subject is enough
      }
    } catch (err) {
      console.error(`[outlook] Recording search failed for "${term}":`, err.message)
    }
  }
  return results
}

/**
 * Search SharePoint for recent meeting transcripts (.vtt files).
 * @param {string} token
 * @param {string} query - Search query
 * @param {number} maxResults
 * @returns {Promise<object[]>}
 */
async function searchTranscripts(token, query, maxResults = 5) {
  try {
    const result = await graphPost(token, `${GRAPH}/search/query`, {
      requests: [{
        entityTypes: ['driveItem'],
        query: { queryString: query },
        from: 0,
        size: maxResults,
      }],
    })
    const hits = result.value?.[0]?.hitsContainers?.[0]?.hits ?? []
    return hits.map(hit => ({
      name: hit.resource?.name ?? '',
      webUrl: hit.resource?.webUrl ?? '',
      size: hit.resource?.size ?? 0,
      createdAt: hit.resource?.createdDateTime ?? '',
      modifiedAt: hit.resource?.lastModifiedDateTime ?? '',
      createdBy: hit.resource?.createdBy?.user?.displayName ?? '',
      summary: (hit.summary ?? '').replace(/<[^>]+>/g, '').slice(0, 200),
      driveItemId: hit.resource?.id ?? '',
      driveId: hit.resource?.parentReference?.driveId ?? '',
    }))
  } catch (err) {
    console.error('[outlook] Transcript search failed:', err.message)
    return []
  }
}

// ── Brief mode ───────────────────────────────────────────────────────────────

/**
 * Fetch inbox emails, today's calendar, and recent transcripts.
 * @param {string} token - Graph access token
 * @param {object} config - Outlook config
 * @param {number} lookbackHours
 * @returns {Promise<object>}
 */
async function runBrief(token, config, lookbackHours) {
  const errors = []
  const since = new Date(Date.now() - lookbackHours * 60 * 60 * 1000).toISOString()
  const rules = config.triage_rules ?? {}

  // Get current user's email for triage
  let myEmail = ''
  try {
    const me = await graphFetch(token, `${GRAPH}/me?$select=mail,userPrincipalName`)
    myEmail = me.mail || me.userPrincipalName || ''
    console.error(`[outlook] Authenticated as ${myEmail}`)
  } catch (err) {
    errors.push(`Profile fetch failed: ${err.message}`)
    console.error('[outlook] Could not fetch profile:', err.message)
  }

  // ── Emails ──
  let emails = []
  let emailsTruncated = false
  try {
    const filter = `receivedDateTime ge ${since}`
    const select = 'id,subject,from,sender,toRecipients,ccRecipients,bodyPreview,receivedDateTime,isRead,importance,hasAttachments,flag'
    const url = `${GRAPH}/me/messages?$filter=${encodeURIComponent(filter)}&$select=${select}&$top=${MAX_EMAILS}&$orderby=receivedDateTime desc`
    const result = await graphFetch(token, url)
    emails = (result.value ?? []).map(msg => mapEmail(msg, rules, myEmail))
    emailsTruncated = !!result['@odata.nextLink']
    console.error(`[outlook] Fetched ${emails.length} emails${emailsTruncated ? ' (truncated)' : ''}`)
  } catch (err) {
    errors.push(`Email fetch failed: ${err.message}`)
    console.error('[outlook] Email fetch failed:', err.message)
  }

  // ── Calendar (today) ──
  let events = []
  let yesterdayOnlineMeetings = []
  try {
    const tz = config.timezone || null
    const todayStart = new Date().toISOString().slice(0, 10) + 'T00:00:00Z'
    const todayEnd = new Date().toISOString().slice(0, 10) + 'T23:59:59Z'
    const select = 'id,subject,start,end,isOnlineMeeting,onlineMeetingUrl,organizer,location,isAllDay,isCancelled'
    const url = `${GRAPH}/me/calendarView?startDateTime=${todayStart}&endDateTime=${todayEnd}&$select=${select}&$top=30&$orderby=start/dateTime`
    const result = await graphFetch(token, url)
    events = (result.value ?? []).map(e => mapEvent(e, tz)).filter(e => !e.isCancelled)
    console.error(`[outlook] Fetched ${events.length} calendar events for today${tz ? ` (tz: ${tz})` : ''}`)

    // Also fetch yesterday's online meetings for recording search
    const yDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const yStart = yDate + 'T00:00:00Z'
    const yEnd = yDate + 'T23:59:59Z'
    const yResult = await graphFetch(token, `${GRAPH}/me/calendarView?startDateTime=${yStart}&endDateTime=${yEnd}&$select=${select}&$top=30&$orderby=start/dateTime`)
    yesterdayOnlineMeetings = (yResult.value ?? [])
      .filter(e => e.isOnlineMeeting && !e.isCancelled)
      .map(e => e.subject)
      .filter(Boolean)
    console.error(`[outlook] Found ${yesterdayOnlineMeetings.length} online meetings yesterday`)
  } catch (err) {
    errors.push(`Calendar fetch failed: ${err.message}`)
    console.error('[outlook] Calendar fetch failed:', err.message)
  }

  // ── Meeting transcripts (.vtt files from Teams, across all accessible drives) ──
  // Search tenant-wide using "Meeting Recording" filename convention — Teams recordings in
  // other users' OneDrive are shared with attendees but won't appear under path:Recordings.
  // Use a 48h lookback window to catch late-indexed files.
  let transcripts = []
  try {
    const cutoff = new Date(Date.now() - Math.max(lookbackHours, 48) * 60 * 60 * 1000)
    const rawTranscripts = await searchTranscripts(token, '"Meeting Recording" filetype:vtt', 30)
    transcripts = rawTranscripts.filter(t => {
      // Use whichever timestamp is newer (created vs modified)
      const ts = t.createdAt && t.modifiedAt
        ? new Date(Math.max(new Date(t.createdAt), new Date(t.modifiedAt)))
        : new Date(t.modifiedAt || t.createdAt || 0)
      return ts >= cutoff
    })
    console.error(`[outlook] Found ${transcripts.length} recent transcripts (${rawTranscripts.length} raw hits filtered to 48h)`)

    // Per-meeting title fallback: if generic search missed any of yesterday's meetings, search by title
    if (transcripts.length < yesterdayOnlineMeetings.length && yesterdayOnlineMeetings.length > 0) {
      const foundNames = new Set(transcripts.map(t => t.name.toLowerCase()))
      const missing = yesterdayOnlineMeetings.filter(subject => {
        const key = subject.slice(0, 20).toLowerCase()
        return ![...foundNames].some(n => n.includes(key))
      })
      for (const subject of missing) {
        const term = subject.slice(0, 40).replace(/['"]/g, '')
        try {
          const hits = await searchTranscripts(token, `"${term}" filetype:vtt`, 3)
          const recent = hits.filter(t => {
            const ts = t.createdAt && t.modifiedAt
              ? new Date(Math.max(new Date(t.createdAt), new Date(t.modifiedAt)))
              : new Date(t.modifiedAt || t.createdAt || 0)
            return ts >= cutoff
          })
          transcripts.push(...recent)
          if (recent.length) console.error(`[outlook] Per-title search found ${recent.length} transcript(s) for: ${subject}`)
        } catch (err) {
          console.error(`[outlook] Per-title transcript search failed for "${subject}":`, err.message)
        }
      }
    }
  } catch (err) {
    errors.push(`Transcript search failed: ${err.message}`)
    console.error('[outlook] Transcript search failed:', err.message)
  }

  // ── Meeting recordings (MP4 links) + VTT sibling fetch ──
  // Always run for yesterday's online meetings. Teams stores recordings in the
  // organizer's OneDrive (not the attendee's), so SharePoint Search won't find
  // them. Instead: find the MP4 via title search, then fetch the .vtt sibling
  // from the same folder using the drive+parent IDs returned by search.
  // ── Meeting recordings (Teams stream URLs from yesterday's online meetings) ──
  // Recordings are stored in the organizer's OneDrive, not the attendee's.
  // VTT transcripts in organizer drives are inaccessible without admin-consent scopes.
  // Strategy: find the MP4 via title search, construct the proper stream URL.
  let recordings = []
  if (yesterdayOnlineMeetings.length > 0) {
    try {
      recordings = await searchRecordings(token, yesterdayOnlineMeetings, Math.max(lookbackHours, 48))
      console.error(`[outlook] Found ${recordings.length} meeting recordings (MP4 links)`)
    } catch (err) {
      errors.push(`Recording search failed: ${err.message}`)
      console.error('[outlook] Recording search failed:', err.message)
    }
  }

  return {
    emails,
    emailsTruncated,
    calendar: events,
    transcripts,
    recordings,
    triageSummary: summarizeTriage(emails),
    errors,
  }
}

/**
 * Summarize triage categories for the daily note.
 * @param {object[]} emails
 * @returns {object}
 */
function summarizeTriage(emails) {
  const counts = {
    action_required: 0,
    fyi: 0,
    newsletter: 0,
    marketing: 0,
    automated_alert: 0,
    junk: 0,
  }
  for (const e of emails) {
    counts[e.triage] = (counts[e.triage] ?? 0) + 1
  }
  return counts
}

// ── Search mode ──────────────────────────────────────────────────────────────

/**
 * Search emails and files by keyword.
 * @param {string} token
 * @param {string} query
 * @param {object} config
 * @returns {Promise<object>}
 */
async function runSearch(token, query, config) {
  const errors = []
  const rules = config.triage_rules ?? {}

  // Get current user's email
  let myEmail = ''
  try {
    const me = await graphFetch(token, `${GRAPH}/me?$select=mail,userPrincipalName`)
    myEmail = me.mail || me.userPrincipalName || ''
  } catch (err) {
    errors.push(`Profile fetch failed: ${err.message}`)
  }

  // ── Search emails ──
  let emails = []
  try {
    const url = `${GRAPH}/me/messages?$search="${encodeURIComponent(query)}"&$select=id,subject,from,sender,toRecipients,ccRecipients,bodyPreview,receivedDateTime,isRead,importance,hasAttachments,flag&$top=${MAX_SEARCH_RESULTS}`
    const result = await graphFetch(token, url)
    emails = (result.value ?? []).map(msg => mapEmail(msg, rules, myEmail))
    console.error(`[outlook] Search found ${emails.length} emails`)
  } catch (err) {
    errors.push(`Email search failed: ${err.message}`)
    console.error('[outlook] Email search failed:', err.message)
  }

  // ── Search files (SharePoint) ──
  let files = []
  try {
    const result = await graphPost(token, `${GRAPH}/search/query`, {
      requests: [{
        entityTypes: ['driveItem'],
        query: { queryString: query },
        from: 0,
        size: MAX_SEARCH_RESULTS,
      }],
    })
    const hits = result.value?.[0]?.hitsContainers?.[0]?.hits ?? []
    files = hits.map(hit => ({
      name: hit.resource?.name ?? '',
      webUrl: hit.resource?.webUrl ?? '',
      size: hit.resource?.size ?? 0,
      modifiedAt: hit.resource?.lastModifiedDateTime ?? '',
      modifiedBy: hit.resource?.lastModifiedBy?.user?.displayName ?? '',
      summary: (hit.summary ?? '').replace(/<[^>]+>/g, '').slice(0, 200),
    }))
    console.error(`[outlook] Search found ${files.length} files`)
  } catch (err) {
    errors.push(`File search failed: ${err.message}`)
    console.error('[outlook] File search failed:', err.message)
  }

  // ── Search transcripts specifically ──
  let transcripts = []
  try {
    transcripts = await searchTranscripts(token, `filetype:vtt ${query}`, 5)
    console.error(`[outlook] Search found ${transcripts.length} transcripts`)
  } catch (err) {
    errors.push(`Transcript search failed: ${err.message}`)
  }

  return { emails, files, transcripts, errors }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const { mode, query, lookbackHours } = parseArgs()

  // Validate env
  if (!process.env.AZURE_TENANT_ID || !process.env.AZURE_CLIENT_ID) {
    console.log(JSON.stringify(envelope(TOOL, mode, null, [
      'AZURE_TENANT_ID and AZURE_CLIENT_ID must be set in .env'
    ])))
    process.exit(1)
  }

  // Load config (optional — triage still works with defaults)
  let config = {}
  try {
    config = await loadConfig('outlook')
  } catch (err) {
    console.error(`[outlook] Config not found — using defaults. ${err.message}`)
    config = { triage_rules: {} }
  }

  // Override lookback from config if set
  const effectiveLookback = config.lookback_hours_override ?? lookbackHours
  console.error(`[outlook] Mode: ${mode}, lookback: ${effectiveLookback}h`)

  // Authenticate
  let token
  try {
    token = await getGraphToken()
  } catch (err) {
    console.log(JSON.stringify(envelope(TOOL, mode, null, [
      `Authentication failed: ${err.message}`
    ])))
    process.exit(1)
  }

  // Run mode
  if (mode === 'search') {
    if (!query) {
      console.log(JSON.stringify(envelope(TOOL, mode, null, [
        'Search mode requires a query: --search "keywords"'
      ])))
      process.exit(1)
    }
    const result = await runSearch(token, query, config)
    const errors = result.errors
    delete result.errors
    console.log(JSON.stringify(envelope(TOOL, mode, result, errors)))
  } else {
    const result = await runBrief(token, config, effectiveLookback)
    const errors = result.errors
    delete result.errors
    console.log(JSON.stringify(envelope(TOOL, mode, result, errors)))
  }
}

main().catch(err => {
  console.error('[outlook] Fatal:', err)
  console.log(JSON.stringify(envelope(TOOL, 'unknown', null, [err.message])))
  process.exit(1)
})
