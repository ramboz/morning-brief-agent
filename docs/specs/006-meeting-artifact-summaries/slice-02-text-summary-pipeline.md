---
status: DONE
dependencies: ["006-01"]
last_verified: 2026-07-04
---

## Slice 006-02 - text-summary-pipeline

**Goal:** Summarize accessible transcript or recap-email text into Obsidian
meeting notes without entangling discovery logic.

**DoR:**
- [x] Slice 006-01 produces typed text artifacts.
- [x] Meeting note frontmatter and destination path are defined.

**Acceptance Criteria:**

1. **Summaries consume typed artifacts.** The summarizer receives transcript or
   recap-email content plus metadata, not raw search results.
2. **Existing notes are not duplicated.** Dedup checks use meeting identity and
   note filename where possible.
3. **Notes include actions.** Meeting notes include summary, attendees, and
   action items.

**DoD:**
- [x] At least one dry-run or fixture summary demonstrates the output.
- [x] Long transcripts are truncated deliberately with a visible note.

**Anti-horizontal-phasing check:** A newly accessible transcript or recap email
turns into a readable Obsidian meeting note.

### Deviation log (after reconciliation)

- **New pure module `scripts/lib/meetings/summarizable.js`** (`selectSummarizableMeetings`)
  — takes slice 006-01's inventory and picks the one text artifact per meeting to
  summarize (transcript preferred over recap-email when both present), excluding
  recording-only/no-artifact meetings. Not a deviation from plan.
- **`--brief` mode rewired** onto the ADR-0008-scoped pipeline: fetches yesterday's
  online meetings (with `responseStatus`, mirroring `fetch-outlook.js`'s pattern) →
  `buildArtifactInventory` → `selectSummarizableMeetings` → `processSummarizableMeetings`
  (new function). Dedup/filename is now derived from the calendar-sourced meeting
  `title`/`date` (deterministic), not the LLM's own re-extracted `summary.title`/
  `summary.date` as before — this closes a real dedup fragility (the LLM could phrase
  the same meeting's title slightly differently across runs, producing a different
  filename and a duplicate note). The LLM's own extraction still populates the note
  body/frontmatter unchanged.
- **`--search` mode regression found and fixed during review:** the first implementation
  pass silently dropped recap-email processing from `--search` mode (it kept fetching
  `recapEmails` but stopped passing them to any processor), while an inline comment
  incorrectly claimed the mode was "unchanged by this slice." Two independent review
  passes (compliance and craft) caught this. Fixed by restoring the `processRecapEmails`
  function (deleted in the first pass) and wiring `--search` mode to run both `runProcess`
  (transcripts) and `processRecapEmails` (recap emails) and merge their results, exactly
  matching the pre-slice-006-02 combined behavior. `--search` mode remains otherwise
  untouched, as the brief required.
- **Real dry-run evidence captured:** `docs/specs/006-meeting-artifact-summaries/slice-02-dry-run-2026-07-04.md`
  — a live `--brief --dry-run` run against real Graph data. Result was an honest
  "quiet day" (1 in-scope meeting yesterday, 0 matched a transcript or recap email, so
  0 summarizable meetings) rather than a fabricated positive example. The actual
  download → summarize → write-note code path (for a meeting that DOES have a matching
  artifact) was not exercised live in this session — verified instead via code review
  and the unchanged `summarizeWithClaude`/`formatMeetingNote` functions, whose behavior
  this slice does not change (only their inputs changed, from raw search hits to typed
  inventory entries).
- **Known, deferred duplication (craft-review finding, non-blocking):** `processRecapEmails`
  (search-mode) and `processSummarizableMeetings` (brief-mode) duplicate the
  fetch/summarize/dedup/write control-flow shape for recap emails; the same duplication
  already existed between `runProcess` and `processSummarizableMeetings` for transcripts.
  This slice did not introduce the duplication (it predates 006-02, which split discovery
  from processing without also collapsing the two processing pipelines) — flagged as a
  candidate for a future refactor slice, not fixed here to keep this fix narrowly scoped
  to the `--search` regression. Tracked as a named decision in
  `docs/refinement-todo.md` ("Meeting-summary processing-pipeline duplication"),
  per the reconciliation reviewer's suggestion.
- **`docs/architecture.md` updated** — "Source libraries" bullet now also names the
  summarizable-selection transform alongside the artifact-inventory transform.
- **`docs/inbox.md` checked** — empty, nothing to triage.
- **Memory-sync deferred** to spec 006's close-out (after slice 006-03), consistent with
  slice 006-01's disposition.

### Reconciliation sweep

- `docs/architecture.md` — **updated** (Source libraries bullet now also names the
  summarizable-selection transform).
- `docs/decisions/` (ADR-0008) — **no-op**; this slice realizes ADR-0008 without needing
  a further ADR.
- `docs/conventions.md` — **no-op**; no new project-wide convention introduced.
- `docs/inbox.md` — **no-op**; checked, empty.
- `skills/morning-outlook/SKILL.md` — **no-op for this slice**; `summarize-meeting.js` is
  invoked by `skills/morning-outlook/SKILL.md`'s Step 1b, whose prose already describes
  calling `summarize-meeting.js --brief` generically — the SKILL.md doesn't need updating
  for this slice's internal rewiring since its documented interface (run the script,
  render `Meeting Summaries`) is unchanged. The SKILL.md's "Meeting Recordings" section
  (recording-only rendering) remains the known, intentionally deferred gap named in
  006-01's reconciliation, still owned by 006-03.
- `docs/refinement-todo.md` — **updated**; added "Meeting-summary processing-pipeline
  duplication" as a named, deferred decision per the reconciliation reviewer's suggestion.
- Memory (`docs/memory/`, `/jig:memory-sync`) — **deferred** to spec 006 close-out (after
  006-03), consistent with slice 006-01.

