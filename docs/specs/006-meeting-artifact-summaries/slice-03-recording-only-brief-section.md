---
status: DONE
dependencies: ["006-01"]
last_verified: 2026-07-04
---

## Slice 006-03 - recording-only-brief-section

**Goal:** Render recording-only meetings in the daily brief as manual-watch
items rather than failed summaries.

**DoR:**
- [x] Slice 006-01 can identify recording-only artifacts.
- [x] Daily brief shell has a place for meeting sections or source warnings.

**Acceptance Criteria:**

1. **Recording links are surfaced.** The brief includes meeting title, date, and
   watch link when available.
2. **Transcript absence is explicit.** The brief says transcript unavailable
   instead of implying summarization failed.
3. **Action wording is calm.** Recording-only items are not treated as urgent
   unless configured or tied to a direct action.

**DoD:**
- [x] Fixture or sample brief output includes a recording-only meeting.
- [x] The section omits itself cleanly when no recording-only artifacts exist.

**Anti-horizontal-phasing check:** The user sees useful meeting follow-up even
when no transcript can be summarized.

### Deviation log (after reconciliation)

- **This slice is prose-only**, editing `skills/morning-outlook/SKILL.md` (a natural-
  language Agent Skill, not code) — no `scripts/**`/`tests/**` changes, consistent with
  this project's CLAUDE.md convention that SKILL.md files "describe WHAT to do, not
  HOW," and mirroring the precedent set by slice 004-01/004-02 (Slack digest rendering)
  for skills with no code-based unit-test seam.
- **Rewired Step 1b and the Meeting Recordings section onto `meetingInventory`**
  (slice 006-01's typed inventory) as the sole source of truth, replacing the old ad hoc
  heuristic ("if `transcripts` empty but `recordings` non-empty, render Meeting
  Recordings"). The new instructions branch explicitly on `hasSummarizableText`,
  `recordingOnly`, and `noArtifactFound` — the three mutually exclusive outcomes
  `buildArtifactInventory` already computes — rather than re-deriving similar logic
  from raw `transcripts`/`recordings` arrays.
- **AC1 gap found and fixed during review:** the first pass's rendered template
  supplied only title + watch link, relying on the section heading's "(yesterday)"
  label for date rather than a per-meeting date, which doesn't literally satisfy AC1's
  "title, date, and watch link" wording and would become ambiguous if the lookback
  window is ever widened past a single day. Both the compliance and craft review
  passes independently flagged this. Fixed by instructing a per-item date (e.g. "(Jul
  3)") sourced from each `meetingInventory` entry's `date` field, shown next to the
  title in every worked example.
- **Cosmetic fix:** a bracket-spacing inconsistency in the worked example
  ("`[2xWeekly]ASO...`" → "`[2xWeekly] ASO...`"), flagged by the compliance pass,
  corrected for internal consistency with the sample-brief evidence file.
- **Evidence captured as real-plus-illustrative**, per the same honesty convention used
  in spec 007's samples: `docs/specs/006-meeting-artifact-summaries/slice-03-sample-brief-2026-07-04.md`
  pairs (1) a real live `fetch-outlook.js --brief` run showing the section correctly
  omitting itself (0 in-scope meetings that day, satisfying DoD item 2 with real data),
  with (2) a clearly-labeled constructed `meetingInventory` entry (schema-accurate,
  matching `buildArtifactInventory`'s real output shape) demonstrating the
  recording-only rendering case (DoD item 1), since no live recording-only meeting
  existed in this session's lookback window.
- **`docs/inbox.md` checked** — empty, nothing to triage.
- **This is spec 006's final slice** — memory-sync (deferred by 006-01 and 006-02 to
  this point) will be run once, immediately after this slice reaches DONE, as part of
  closing out spec 006 as a whole (there is no separate written close-out section in
  `spec.md` for this — the consolidation happens via a `/jig:memory-sync` run, not a
  doc artifact), rather than being repeated per-slice.

### Reconciliation sweep

- `skills/morning-outlook/SKILL.md` — **updated**; this slice's actual deliverable.
  This also resolves the "known, intentional gap" named in 006-01's and 006-02's
  reconciliation sweeps (the SKILL.md previously still described the pre-ADR-0008
  pipeline) — that gap is now closed.
- `docs/architecture.md` — **no-op**; no new module boundary or library introduced by
  this slice (it consumes `scripts/lib/meetings/**`, already documented in 006-01/006-02).
- `docs/decisions/` (ADR-0008) — **no-op**; this slice completes ADR-0008's realization
  without needing a further ADR.
- `docs/conventions.md` — **no-op**; no new project-wide convention.
- `docs/inbox.md` — **no-op**; checked, empty.
- `docs/refinement-todo.md` — **no-op**; no entry references this slice.
- Memory (`docs/memory/`, `/jig:memory-sync`) — **updated**; run now as spec 006's
  close-out consolidation (see below), covering learnings from all three slices at once
  rather than three separate runs, per the disposition recorded in 006-01/006-02.

