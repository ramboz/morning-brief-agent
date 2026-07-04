/**
 * Summarizable-meeting selection — a pure function that turns the artifact
 * inventory produced by buildArtifactInventory() (slice 006-01) into the
 * list of meetings the summarization pipeline should actually process.
 *
 * Implements slice 006-02 (docs/specs/006-meeting-artifact-summaries):
 * summarization must consume typed artifacts plus meeting metadata, not
 * raw search results (AC1), and dedup must be keyed on meeting identity —
 * exactly one entry per meeting even if it has multiple text-bearing
 * artifacts (AC2).
 *
 * No network, no fs, no process.env — deterministic given its input.
 */

/**
 * Select the one text artifact to summarize per meeting: transcript is
 * preferred over recap email when a meeting has both. Meetings without
 * summarizable text (recording-only or no artifact at all) are excluded —
 * those are rendered elsewhere (slice 006-03), not summarized here.
 * @param {object[]} inventory - Output of buildArtifactInventory()
 * @returns {object[]} One entry per summarizable meeting:
 *   { meetingId, title, date, organizer, sourceType: 'transcript'|'recap_email', artifact }
 */
export function selectSummarizableMeetings(inventory) {
  const meetings = Array.isArray(inventory) ? inventory : []
  const out = []

  for (const meeting of meetings) {
    if (!meeting || meeting.hasSummarizableText !== true) continue

    const artifacts = Array.isArray(meeting.artifacts) ? meeting.artifacts : []
    const transcript = artifacts.find(a => a?.type === 'transcript')
    const recapEmail = artifacts.find(a => a?.type === 'recap_email')
    const artifact = transcript || recapEmail
    if (!artifact) continue

    out.push({
      meetingId: meeting.meetingId,
      title: meeting.title,
      date: meeting.date,
      organizer: meeting.organizer,
      sourceType: transcript ? 'transcript' : 'recap_email',
      artifact,
    })
  }

  return out
}
