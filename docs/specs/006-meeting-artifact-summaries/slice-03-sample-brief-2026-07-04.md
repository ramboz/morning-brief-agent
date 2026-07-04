# Slice 006-03 — sample brief evidence (2026-07-04)

Two pieces of evidence for this slice's DoD, per this project's established pattern
of pairing real output with a clearly-labeled illustrative example when live data
doesn't happen to exercise the interesting case that day (see spec 007's samples).

## 1. Real evidence — the section omits itself cleanly (DoD item 2)

Live `node scripts/fetch-outlook.js --brief` run against real Microsoft Graph data:

```
[outlook] Fetched 3 calendar events for today
[outlook] Found 1 online meetings yesterday
[outlook] Found 0 recent transcripts (4 raw hits filtered to 48h)
[outlook] Found 0 meeting recordings (MP4 links)
[outlook] Built meeting artifact inventory: 0 meeting(s)
```

`meetingInventory` is `[]` — the one online meeting on yesterday's calendar didn't
carry an in-scope `responseStatus` (accepted/tentativelyAccepted), so it correctly
never appears at all (ADR-0008 scope, slice 006-01 AC4), and no transcript or
recording matched anything else in the window either way. Following this SKILL.md's
updated instructions, both the "Meeting Summaries" and "Meeting Recordings" sections
are omitted entirely from today's brief — no empty headings, no "0 meetings found"
placeholder text.

## 2. Illustrative example — a recording-only meeting renders correctly (DoD item 1)

**This meetingInventory entry is constructed, not from a live run** (no real
recording-only meeting existed in this session's lookback window). Shape matches
`buildArtifactInventory`'s real output exactly (`scripts/lib/meetings/inventory.js`):

```json
{
  "meetingId": "aso auto optimize check in|2026-07-03",
  "title": "[2xWeekly] ASO Auto-Optimize Check-In",
  "date": "2026-07-03T15:00:00.0000000",
  "organizer": { "name": "Priya Patel", "email": "priya@adobe.com" },
  "artifacts": [
    {
      "type": "recording",
      "name": "2xWeekly ASO Auto-Optimize Check-In-20260703_150000-Meeting Recording.mp4",
      "webUrl": "https://adobe-my.sharepoint.com/sites/aso/_layouts/15/stream.aspx?id=/aso-checkin.mp4",
      "recordedAt": "2026-07-03T19:10:00Z"
    }
  ],
  "hasSummarizableText": false,
  "recordingOnly": true,
  "noArtifactFound": false
}
```

Rendered per this slice's updated SKILL.md instructions:

```markdown
### 🎬 Meeting Recordings (yesterday)
- **[2xWeekly] ASO Auto-Optimize Check-In** (Jul 3) — [Watch recording](https://adobe-my.sharepoint.com/sites/aso/_layouts/15/stream.aspx?id=/aso-checkin.mp4) *(transcript unavailable)*
```

This demonstrates AC1 (title + date + watch link surfaced, per-item — not just via the
section heading), AC2 ("transcript unavailable" — not "summarization failed"), and AC3
(no urgency styling, no 🔴, not folded into Action Required).
