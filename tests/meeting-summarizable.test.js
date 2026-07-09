import test from 'node:test'
import assert from 'node:assert/strict'
import { selectSummarizableMeetings } from '../scripts/lib/meetings/summarizable.js'

function baseMeeting(overrides = {}) {
  return {
    meetingId: 'meeting-key|2026-07-03',
    title: 'Sprint Planning: Core Web Vitals',
    date: '2026-07-03T14:00:00.0000000',
    organizer: { name: 'Alice Adobe', email: 'alice@adobe.com' },
    artifacts: [],
    hasSummarizableText: false,
    recordingOnly: false,
    noArtifactFound: false,
    ...overrides,
  }
}

const transcriptArtifact = {
  type: 'transcript',
  name: 'Sprint Planning Core Web Vitals-20260703_140000-Meeting Recording.vtt',
  webUrl: 'https://adobe-my.sharepoint.com/transcript.vtt',
  driveId: 'drive-alice',
  driveItemId: 'item-transcript-1',
}

const recapEmailArtifact = {
  type: 'recap_email',
  id: 'email-1',
  subject: 'Customer Sync: Bulk.com Renewal — Notes',
  from: 'Bob Bulk',
  fromEmail: 'bob@bulk.com',
  receivedAt: '2026-07-03T16:00:00.0000000',
  webLink: 'https://outlook.office.com/mail/id/email-1',
}

const recordingArtifact = {
  type: 'recording',
  name: 'All Hands-20260703_100000-Meeting Recording.mp4',
  webUrl: 'https://adobe-my.sharepoint.com/allhands.mp4',
  recordedAt: '2026-07-03T10:00:00.0000000',
}

test('AC1: a transcript-having meeting selects the transcript artifact with meeting metadata carried through', () => {
  const meeting = baseMeeting({
    artifacts: [transcriptArtifact],
    hasSummarizableText: true,
  })

  const out = selectSummarizableMeetings([meeting])

  assert.equal(out.length, 1)
  const entry = out[0]
  assert.equal(entry.meetingId, meeting.meetingId)
  assert.equal(entry.title, meeting.title)
  assert.equal(entry.date, meeting.date)
  assert.deepEqual(entry.organizer, meeting.organizer)
  assert.equal(entry.sourceType, 'transcript')
  assert.deepEqual(entry.artifact, transcriptArtifact)
})

test('AC1/AC2: a meeting with both a transcript and a recap-email artifact produces exactly one entry, preferring the transcript', () => {
  const meeting = baseMeeting({
    artifacts: [recapEmailArtifact, transcriptArtifact],
    hasSummarizableText: true,
  })

  const out = selectSummarizableMeetings([meeting])

  assert.equal(out.length, 1, 'expected exactly one entry, not one per artifact')
  assert.equal(out[0].sourceType, 'transcript')
  assert.deepEqual(out[0].artifact, transcriptArtifact)
})

test('a recap-email-only meeting selects the recap-email artifact', () => {
  const meeting = baseMeeting({
    title: 'Customer Sync: Bulk.com Renewal',
    artifacts: [recapEmailArtifact],
    hasSummarizableText: true,
  })

  const out = selectSummarizableMeetings([meeting])

  assert.equal(out.length, 1)
  assert.equal(out[0].sourceType, 'recap_email')
  assert.deepEqual(out[0].artifact, recapEmailArtifact)
  assert.equal(out[0].title, meeting.title)
})

test('a recording-only meeting and a no-artifact meeting are both excluded', () => {
  const recordingOnly = baseMeeting({
    title: 'All Hands: Q3 Roadmap Review',
    artifacts: [recordingArtifact],
    hasSummarizableText: false,
    recordingOnly: true,
  })
  const noArtifact = baseMeeting({
    title: '1:1 with Manager',
    artifacts: [],
    hasSummarizableText: false,
    noArtifactFound: true,
  })

  const out = selectSummarizableMeetings([recordingOnly, noArtifact])

  assert.deepEqual(out, [])
})

test('mixed inventory: only summarizable meetings are selected, in order', () => {
  const transcriptMeeting = baseMeeting({ artifacts: [transcriptArtifact], hasSummarizableText: true })
  const recapMeeting = baseMeeting({
    title: 'Customer Sync: Bulk.com Renewal',
    artifacts: [recapEmailArtifact],
    hasSummarizableText: true,
  })
  const recordingOnly = baseMeeting({
    title: 'All Hands: Q3 Roadmap Review',
    artifacts: [recordingArtifact],
    hasSummarizableText: false,
    recordingOnly: true,
  })
  const noArtifact = baseMeeting({
    title: '1:1 with Manager',
    artifacts: [],
    hasSummarizableText: false,
    noArtifactFound: true,
  })

  const out = selectSummarizableMeetings([transcriptMeeting, recordingOnly, recapMeeting, noArtifact])

  assert.equal(out.length, 2)
  assert.deepEqual(out.map(e => e.sourceType), ['transcript', 'recap_email'])
})

test('robustness: empty inventory produces an empty list without throwing', () => {
  assert.deepEqual(selectSummarizableMeetings([]), [])
})
