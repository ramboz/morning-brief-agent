import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { buildArtifactInventory, meetingKey } from '../scripts/lib/meetings/inventory.js'

async function loadFixture() {
  return JSON.parse(await readFile('tests/fixtures/meeting-artifact-inventory.json', 'utf8'))
}

test('AC1: transcript-only, recap-email-only, and recording-only meetings produce correctly-typed artifacts', async () => {
  const fixture = await loadFixture()
  const out = buildArtifactInventory(fixture)

  const transcriptOnly = out.find(m => m.title === 'Sprint Planning: Core Web Vitals')
  assert.ok(transcriptOnly, 'expected transcript-only meeting to be present')
  assert.equal(transcriptOnly.artifacts.length, 1)
  assert.equal(transcriptOnly.artifacts[0].type, 'transcript')
  assert.equal(transcriptOnly.artifacts[0].name, 'Sprint Planning Core Web Vitals-20260703_140000-Meeting Recording.vtt')
  assert.equal(transcriptOnly.artifacts[0].driveId, 'drive-alice')
  assert.equal(transcriptOnly.artifacts[0].driveItemId, 'item-transcript-1')
  assert.equal(transcriptOnly.hasSummarizableText, true)
  assert.equal(transcriptOnly.recordingOnly, false)
  assert.equal(transcriptOnly.noArtifactFound, false)

  const recapOnly = out.find(m => m.title === 'Customer Sync: Bulk.com Renewal')
  assert.ok(recapOnly, 'expected recap-email-only meeting to be present')
  assert.equal(recapOnly.artifacts.length, 1)
  assert.equal(recapOnly.artifacts[0].type, 'recap_email')
  assert.equal(recapOnly.artifacts[0].id, 'email-1')
  assert.equal(recapOnly.artifacts[0].fromEmail, 'bob@bulk.com')
  assert.equal(recapOnly.hasSummarizableText, true)
  assert.equal(recapOnly.recordingOnly, false)
  assert.equal(recapOnly.noArtifactFound, false)

  const recordingOnly = out.find(m => m.title === 'All Hands: Q3 Roadmap Review')
  assert.ok(recordingOnly, 'expected recording-only meeting to be present')
  assert.equal(recordingOnly.artifacts.length, 1)
  assert.equal(recordingOnly.artifacts[0].type, 'recording')
  assert.equal(recordingOnly.artifacts[0].webUrl, 'https://adobe-my.sharepoint.com/sites/allhands/_layouts/15/stream.aspx?id=/allhands.mp4')
  assert.equal(recordingOnly.hasSummarizableText, false)
  assert.equal(recordingOnly.recordingOnly, true)
  assert.equal(recordingOnly.noArtifactFound, false)
})

test('AC2: a meeting with both a transcript hit and a recording hit collapses to one record with two artifacts', async () => {
  const fixture = await loadFixture()
  const out = buildArtifactInventory(fixture)

  const matches = out.filter(m => m.title === 'Architecture Review: Auto-Optimize Pipeline')
  assert.equal(matches.length, 1, 'expected exactly one record for the meeting, not one per artifact')

  const meeting = matches[0]
  assert.equal(meeting.artifacts.length, 2)
  const types = meeting.artifacts.map(a => a.type).sort()
  assert.deepEqual(types, ['recording', 'transcript'])
  assert.equal(meeting.hasSummarizableText, true)
  assert.equal(meeting.recordingOnly, false)
  assert.equal(meeting.noArtifactFound, false)
})

test('AC3: a meeting with zero matched artifacts still appears with noArtifactFound true and no artifacts', async () => {
  const fixture = await loadFixture()
  const out = buildArtifactInventory(fixture)

  const noArtifacts = out.find(m => m.title === '1:1 with Manager')
  assert.ok(noArtifacts, 'expected in-scope meeting with no artifacts to still appear')
  assert.deepEqual(noArtifacts.artifacts, [])
  assert.equal(noArtifacts.noArtifactFound, true)
  assert.equal(noArtifacts.hasSummarizableText, false)
  assert.equal(noArtifacts.recordingOnly, false)
})

test('AC4: declined and notResponded meetings are completely absent from the output', async () => {
  const fixture = await loadFixture()
  const out = buildArtifactInventory(fixture)

  const titles = out.map(m => m.title)
  assert.ok(!titles.includes('Declined Meeting: Should Not Appear'))
  assert.ok(!titles.includes('Not Responded Meeting: Should Not Appear'))
  assert.ok(!titles.includes('Cancelled Meeting: Should Not Appear'))
  assert.ok(!titles.includes('In-Person Offsite: Should Not Appear'))

  // Length assertion — not just a flag check. Fixture has 12 calendar events;
  // 4 are out of scope (declined, notResponded, cancelled, not-online).
  assert.equal(out.length, 8, 'expected exactly the 8 in-scope meetings, excluded ones must not appear at all')
})

test('AC2 disambiguation: an artifact matching two same-day meetings with a shared title prefix attaches to the closer-in-time one, not the first one encountered', async () => {
  const fixture = await loadFixture()
  const out = buildArtifactInventory(fixture)

  // Both meetings normalize to the same 20-char title prefix ("weekly sync with tea"),
  // so title matching alone is ambiguous — the recording (recordedAt 19:00) is 10h
  // after "Team Alpha" (09:00) but only 4h after "Team Beta" (15:00). A first-match-wins
  // strategy would wrongly attach it to Alpha, since Alpha appears first in the fixture.
  const alpha = out.find(m => m.title === 'Weekly Sync with Team Alpha')
  const beta = out.find(m => m.title === 'Weekly Sync with Team Beta')
  assert.ok(alpha, 'expected Team Alpha meeting to be present')
  assert.ok(beta, 'expected Team Beta meeting to be present')

  assert.equal(alpha.artifacts.length, 0, 'Alpha is closer in title-prefix order but farther in time — must not receive the artifact')
  assert.equal(beta.artifacts.length, 1, 'Beta is closer in time to the recording — must receive it')
  assert.equal(beta.artifacts[0].type, 'recording')
  assert.equal(beta.artifacts[0].name, 'Weekly Sync with Team Beta-20260703_150000-Meeting Recording.mp4')
})

test('AC5: an externally-organized meeting still gets its recording matched via title+time', async () => {
  const fixture = await loadFixture()
  const out = buildArtifactInventory(fixture)

  const external = out.find(m => m.title === 'Vendor Kickoff: SAP Integration Planning')
  assert.ok(external, 'expected externally-organized meeting to be present')
  assert.equal(external.organizer.email, 'sam@sap.com')
  assert.equal(external.artifacts.length, 1)
  assert.equal(external.artifacts[0].type, 'recording')
  assert.equal(external.hasSummarizableText, false)
  assert.equal(external.recordingOnly, true)
})

test('meetingKey: normalizes title casing/punctuation and combines with date', () => {
  const a = meetingKey('Sprint Planning: Core Web Vitals', '2026-07-03T14:00:00.0000000')
  const b = meetingKey('sprint planning core web vitals', '2026-07-03T09:00:00.0000000')
  assert.equal(a, b, 'same normalized title + same local date must produce the same key')

  const differentDay = meetingKey('Sprint Planning: Core Web Vitals', '2026-07-04T14:00:00.0000000')
  assert.notEqual(a, differentDay, 'different date must produce a different key')
})

test('robustness: empty inputs produce an empty inventory without throwing', () => {
  assert.deepEqual(buildArtifactInventory({ calendarEvents: [], transcripts: [], recordings: [], recapEmails: [] }), [])
})

test('robustness: missing arrays default gracefully', () => {
  const out = buildArtifactInventory({ calendarEvents: [
    {
      subject: 'Solo Meeting',
      start: { dateTime: '2026-07-03T10:00:00.0000000' },
      isOnlineMeeting: true,
      isCancelled: false,
      responseStatus: { response: 'accepted' },
      organizer: { emailAddress: { name: 'Solo', address: 'solo@adobe.com' } },
    },
  ] })
  assert.equal(out.length, 1)
  assert.equal(out[0].noArtifactFound, true)
})
