/**
 * Meeting artifact inventory — a pure, unit-testable transform that takes
 * raw Graph search/calendar results and returns a deduplicated, typed
 * inventory of meetings-with-artifacts.
 *
 * Implements slice 006-01 (docs/specs/006-meeting-artifact-summaries) per
 * the scope/access boundaries settled by ADR-0008
 * (docs/decisions/adr-0008-meeting-artifact-pipeline-separation.md):
 * discovery only considers non-cancelled online meetings with
 * responseStatus.response of "accepted" or "tentativelyAccepted";
 * "declined" and "notResponded" meetings never appear in the output.
 *
 * No network, no fs, no process.env — deterministic given its inputs.
 */

/** responseStatus.response values that put a meeting in scope for discovery. */
const IN_SCOPE_RESPONSES = new Set(['accepted', 'tentativelyAccepted'])

/** Artifact timestamps are matched within this window after meeting start. */
const ARTIFACT_MATCH_WINDOW_HOURS = 48

/** Number of leading characters of a normalized title used for prefix matching. */
const TITLE_PREFIX_LEN = 20

/**
 * Lowercase a title and strip punctuation/extra whitespace.
 * @param {string} title
 * @returns {string}
 */
function normalizeTitle(title) {
  return (title ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Derive the local calendar date (YYYY-MM-DD) from a Graph-style datetime
 * string. Graph calendarView datetimes are already in local/display time
 * once converted upstream (see fetch-outlook.js's toLocalTime), but this
 * also works directly on raw UTC-without-Z strings and ISO strings — it
 * just reads the date portion, no timezone conversion happens here.
 * @param {string} isoDateTime
 * @returns {string}
 */
function dateKey(isoDateTime) {
  return (isoDateTime ?? '').slice(0, 10)
}

/**
 * Build the deduplication key for a meeting: normalized title + local date.
 * Exported so identity logic is independently testable.
 * @param {string} subject - Original (non-normalized) meeting subject
 * @param {string} isoDateTime - Meeting start datetime
 * @returns {string}
 */
export function meetingKey(subject, isoDateTime) {
  return `${normalizeTitle(subject)}|${dateKey(isoDateTime)}`
}

/**
 * Whether a raw calendar event is in scope for artifact discovery per
 * ADR-0008: non-cancelled, online, and responseStatus accepted/tentative.
 * @param {object} evt
 * @returns {boolean}
 */
function isInScope(evt) {
  if (!evt || typeof evt !== 'object') return false
  if (evt.isOnlineMeeting !== true) return false
  if (evt.isCancelled !== false) return false
  const response = evt.responseStatus?.response
  return IN_SCOPE_RESPONSES.has(response)
}

/**
 * First ~20-40 chars of a normalized title, used as a prefix-match key.
 * Reuses the same heuristic as fetch-outlook.js's searchRecordings /
 * per-title transcript fallback (first N chars, case-insensitive includes).
 * @param {string} title
 * @returns {string}
 */
function titlePrefix(title) {
  return normalizeTitle(title).slice(0, TITLE_PREFIX_LEN)
}

/**
 * Whether an artifact's name/subject matches a meeting's title via
 * normalized-prefix substring matching (same heuristic already used
 * in fetch-outlook.js).
 * @param {string} meetingTitle
 * @param {string} artifactLabel - artifact's name/subject/label field
 * @returns {boolean}
 */
function titleMatches(meetingTitle, artifactLabel) {
  const prefix = titlePrefix(meetingTitle)
  if (!prefix) return false
  return normalizeTitle(artifactLabel).includes(prefix)
}

/**
 * Parse a datetime string to epoch millis, treating a missing UTC offset as
 * UTC. Graph calendarView datetimes come back without a "Z" suffix but are
 * UTC (same convention fetch-outlook.js's toLocalTime relies on) — without
 * this, JS `Date` would interpret them in the host machine's local timezone.
 * @param {string} datetime
 * @returns {number} epoch millis, or NaN if unparseable
 */
function toEpochMillis(datetime) {
  if (!datetime) return NaN
  const hasOffset = /Z$|[+-]\d{2}:\d{2}$/.test(datetime)
  return new Date(hasOffset ? datetime : `${datetime}Z`).getTime()
}

/**
 * Whether an artifact timestamp falls within [meetingStart, meetingStart + 48h].
 * Artifacts indexed slightly before the recorded start (clock skew) are
 * tolerated by allowing a small negative slack.
 * @param {string} meetingStartIso
 * @param {string} artifactTimestampIso
 * @returns {boolean}
 */
function withinArtifactWindow(meetingStartIso, artifactTimestampIso) {
  const start = toEpochMillis(meetingStartIso)
  const ts = toEpochMillis(artifactTimestampIso)
  if (Number.isNaN(start) || Number.isNaN(ts)) return false
  const windowMs = ARTIFACT_MATCH_WINDOW_HOURS * 60 * 60 * 1000
  const slackMs = 60 * 60 * 1000 // tolerate up to 1h of clock skew before start
  return ts >= start - slackMs && ts <= start + windowMs
}

/**
 * Find the in-scope meeting an artifact belongs to. Title-prefix matching
 * alone is ambiguous when two same-day meetings share a title prefix (e.g.
 * "Weekly Sync with Team Alpha" / "... Team Beta" both truncate to the same
 * TITLE_PREFIX_LEN chars) — disambiguate by picking the candidate whose
 * meeting start is closest to the artifact's timestamp, rather than the
 * first one encountered (craft-review finding, slice 006-01).
 * @param {object[]} meetingList
 * @param {string} label - artifact's name/subject
 * @param {string} artifactTimestampIso
 * @returns {object|null}
 */
function findMatchingMeeting(meetingList, label, artifactTimestampIso) {
  const candidates = meetingList.filter(
    m => titleMatches(m.title, label) && withinArtifactWindow(m.date, artifactTimestampIso)
  )
  if (candidates.length <= 1) return candidates[0] ?? null

  const artifactMs = toEpochMillis(artifactTimestampIso)
  return candidates.reduce((closest, m) => {
    const closestDiff = Math.abs(toEpochMillis(closest.date) - artifactMs)
    const diff = Math.abs(toEpochMillis(m.date) - artifactMs)
    return diff < closestDiff ? m : closest
  })
}

/**
 * Map a raw calendar event to the inventory record shape (before artifacts
 * are attached).
 * @param {object} evt
 * @returns {object}
 */
function toMeetingRecord(evt) {
  return {
    meetingId: meetingKey(evt.subject, evt.start?.dateTime),
    title: evt.subject ?? '(no subject)',
    date: evt.start?.dateTime ?? '',
    organizer: {
      name: evt.organizer?.emailAddress?.name ?? '',
      email: evt.organizer?.emailAddress?.address ?? '',
    },
    artifacts: [],
    hasSummarizableText: false,
    recordingOnly: false,
    noArtifactFound: false,
  }
}

/**
 * Build a deduplicated, typed inventory of meeting artifacts.
 * @param {object} params
 * @param {object[]} [params.calendarEvents] - Raw-ish Graph calendar event objects
 * @param {object[]} [params.transcripts] - searchTranscripts()-shaped results
 * @param {object[]} [params.recordings] - searchRecordings()-shaped results
 * @param {object[]} [params.recapEmails] - findMeetingRecapEmails()-shaped results
 * @returns {object[]} One record per in-scope calendar event
 */
export function buildArtifactInventory({ calendarEvents, transcripts, recordings, recapEmails } = {}) {
  const events = Array.isArray(calendarEvents) ? calendarEvents : []
  const transcriptList = Array.isArray(transcripts) ? transcripts : []
  const recordingList = Array.isArray(recordings) ? recordings : []
  const recapEmailList = Array.isArray(recapEmails) ? recapEmails : []

  const inScope = events.filter(isInScope)

  // Build one record per in-scope calendar event, keyed by meetingId. Since
  // meetingId is derived from title+date, distinct calendar events that
  // collide on the same key are extremely unlikely in practice (would mean
  // two identically-titled meetings on the same day) — dedup by key here too
  // so the contract (one record per meeting) holds even in that edge case.
  const records = new Map()
  for (const evt of inScope) {
    const record = toMeetingRecord(evt)
    if (!records.has(record.meetingId)) {
      records.set(record.meetingId, record)
    }
  }

  const meetingList = [...records.values()]

  for (const t of transcriptList) {
    if (!t || typeof t !== 'object') continue
    const label = t.name ?? ''
    const ts = t.createdAt || t.modifiedAt
    const match = findMatchingMeeting(meetingList, label, ts)
    if (!match) continue
    match.artifacts.push({
      type: 'transcript',
      name: t.name ?? '',
      webUrl: t.webUrl ?? '',
      driveId: t.driveId ?? '',
      driveItemId: t.driveItemId ?? '',
    })
  }

  for (const r of recordingList) {
    if (!r || typeof r !== 'object') continue
    const label = r.subject || r.name || ''
    const ts = r.recordedAt
    const match = findMatchingMeeting(meetingList, label, ts)
    if (!match) continue
    match.artifacts.push({
      type: 'recording',
      name: r.name ?? '',
      webUrl: r.webUrl ?? r.streamUrl ?? '',
      recordedAt: r.recordedAt ?? '',
    })
  }

  for (const e of recapEmailList) {
    if (!e || typeof e !== 'object') continue
    const label = e.subject ?? ''
    const ts = e.receivedAt
    const match = findMatchingMeeting(meetingList, label, ts)
    if (!match) continue
    match.artifacts.push({
      type: 'recap_email',
      id: e.id ?? '',
      subject: e.subject ?? '',
      from: e.from ?? '',
      fromEmail: e.fromEmail ?? '',
      receivedAt: e.receivedAt ?? '',
      webLink: e.webLink ?? '',
    })
  }

  for (const m of meetingList) {
    const types = new Set(m.artifacts.map(a => a.type))
    m.hasSummarizableText = types.has('transcript') || types.has('recap_email')
    m.recordingOnly = m.artifacts.length > 0 && types.size === 1 && types.has('recording')
    m.noArtifactFound = m.artifacts.length === 0
  }

  return meetingList
}
