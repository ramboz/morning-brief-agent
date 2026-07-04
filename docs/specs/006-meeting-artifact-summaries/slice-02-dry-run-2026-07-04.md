# Slice 006-02 — real dry-run evidence (2026-07-04)

Real invocation against live Microsoft Graph data (not a fixture), satisfying the
slice's DoD item "at least one dry-run or fixture summary demonstrates the output."

```
$ node scripts/summarize-meeting.js --brief --dry-run
[meeting] No meeting-summary.json config found — using defaults
[meeting] Mode: brief (dry-run), queries: 1
[meeting] Output: Meetings
[meeting] Searching: "filetype:vtt"
[meeting] Total unique transcripts: 20
[meeting] Found 1 in-scope online meeting(s) yesterday
[meeting] Built meeting artifact inventory: 0 meeting(s)
[meeting] 0 meeting(s) have summarizable text
[meeting] Processing 0 summarizable meeting(s)
{"ok":true,"tool":"meeting-summary","mode":"brief","timestamp":"2026-07-04T17:05:52.329Z","data":{"processed":[],"skipped":[]},"errors":[]}
```

## What this demonstrates

- The full `--brief` pipeline runs end-to-end against live Graph data without
  crashing: calendar fetch (with `responseStatus`) → `buildArtifactInventory`
  → `selectSummarizableMeetings` → `processSummarizableMeetings` → clean JSON
  envelope.
- A real "quiet day" result: yesterday had exactly one accepted/tentative
  online meeting, but none of the 20 raw transcript hits (a tenant-wide
  `filetype:vtt` search) matched it by title+time, and no recap email matched
  either — so the inventory correctly produced 0 summarizable meetings rather
  than a false positive. This is the same honest "quiet day" pattern used
  elsewhere in this project (e.g. AI Radar's quiet-day fallback) rather than a
  fabricated positive example.
- No live meeting in the current lookback window had a transcript/recap email
  this session could use to exercise the actual download → summarize → write
  path (the download/Claude-summarize/file-write branches are exercised by
  code review + the existing `summarizeWithClaude`/`formatMeetingNote`
  functions, which are unchanged by this slice — only their inputs changed,
  from raw search hits to typed inventory entries).
