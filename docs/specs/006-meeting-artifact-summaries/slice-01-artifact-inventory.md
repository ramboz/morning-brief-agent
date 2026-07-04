---
status: DONE
dependencies: [adr-0008]
last_verified: 2026-07-04
arch_review: true
---

## Slice 006-01 - artifact-inventory

**Goal:** Return a structured inventory of meeting artifacts before attempting
summarization.

**DoR:**
- [x] Current `scripts/fetch-outlook.js` and `scripts/summarize-meeting.js`
      behavior has been reviewed.
- [x] Graph auth requirements are known.
- [x] ADR-0008 Accepted — invitation scope and access boundaries settled.

**Acceptance Criteria:**

1. **Artifacts are typed.** Transcript files, recap emails, and MP4 recording
   links are represented as distinct artifact types.
2. **Deduplication is explicit.** Multiple hits for the same meeting collapse to
   one meeting record with multiple artifacts.
3. **Unavailable text is visible.** Recording-only cases preserve a watch link
   and explain why summarization cannot happen.
4. **Invitation scope per ADR-0008.** Discovery only considers non-cancelled
   online meetings with `responseStatus.response` of `accepted` or
   `tentativelyAccepted`; `declined` and `notResponded` meetings are excluded
   entirely (never appear in the inventory, not even as skipped entries).
5. **Cross-tenant meetings degrade gracefully.** A meeting organized outside
   the tenant is still inventoried (via title/time-window matching against
   MP4/recap-email search), but without calendar-based meeting-ID resolution,
   consistent with ADR-0008's documented boundary.

**DoD:**
- [x] Sample inventory output covers at least transcript, recap email, and
      recording-only cases.
- [x] The script still fails independently when Graph search fails.
- [x] A fixture/sample demonstrates a declined or notResponded meeting being
      excluded from the inventory.

**Anti-horizontal-phasing check:** The user can see which meetings have notes,
which have recordings, and which need manual attention.

### Deviation log (after reconciliation)

- **New shared module `scripts/lib/meetings/inventory.js`** (`buildArtifactInventory`,
  `meetingKey`) — pure, network/fs/env-free transform, per the design agreed before
  implementation. Not a deviation from plan.
- **Extracted `scripts/lib/meetings/recapEmail.js`** out of `scripts/summarize-meeting.js`
  (`findMeetingRecapEmails`, `fetchEmailBody`), so `fetch-outlook.js` and
  `summarize-meeting.js` share one implementation instead of risking drift between two
  copies. `summarize-meeting.js`'s own discovery/summarization behavior is otherwise
  untouched — it does not yet consume `buildArtifactInventory`; wiring it in is slice
  006-02's scope.
- **Meeting identity / dedup key (resolves ADR-0008's open question):** implemented as
  `normalizedTitle + '|' + localDateKey` (`meetingKey()`), an implementation-level
  decision, not ADR-worthy — it's a direct continuation of the title/time matching
  heuristic already used by `fetch-outlook.js`'s pre-existing `searchRecordings`/
  per-title transcript fallback, not a new architectural choice with rejected
  alternatives.
- **Artifact-to-meeting matching bug found and fixed during review:** the craft-review
  pass (and, independently, one compliance-review pass) flagged that the initial
  implementation matched artifacts to meetings via `Array.find` (first-match-wins) on
  title-prefix + 48h time window, which can silently misattach an artifact when two
  same-day meetings share a title prefix (e.g. "Weekly Sync with Team Alpha" / "...
  Team Beta" both truncate to the same 20-char prefix). Fixed by introducing
  `findMatchingMeeting()`, which filters to all in-window title-matching candidates
  and — when there's more than one — picks the one closest in time to the artifact.
  Added a regression test (`evt-ambiguous-prefix-a`/`evt-ambiguous-prefix-b` fixture
  events, "AC2 disambiguation" test) that fails under the old `Array.find` logic and
  passes under the fix (verified by hand before/after). Exact-tie behavior (an
  artifact equidistant in time from two candidates) is undefined/untested — noted by
  two reviewers as a minor, non-blocking edge case.
- **`scripts/fetch-outlook.js` cleanup:** removed a leftover duplicate comment block
  near the recordings section (pre-existing, unrelated to this slice's diff, cleaned
  up in passing since it was directly adjacent to code this slice touches).
- **`docs/architecture.md` updated** to name `scripts/lib/meetings/**` in the "Source
  libraries" bullet, cross-referencing ADR-0008 (arch-review finding).
- **Known, intentional gap — not fixed in this slice:** `skills/morning-outlook/SKILL.md`
  still documents the pre-ADR-0008 pipeline (a global, calendar-agnostic VTT search
  with no invitation-scope filtering, plus its own "Meeting Recordings" rendering
  logic). It is not yet wired to `meetingInventory` or ADR-0008's scope rule.
  Rewriting it now would be premature — slices 006-02 (summarization) and 006-03
  (recording-only brief rendering) are what actually replace this SKILL.md's Step 1b
  and "Meeting Recordings" section with logic driven by the new inventory. Tracked
  here so it isn't mistaken for an oversight.
- **`docs/inbox.md` checked** — empty (template only), nothing to triage.
- **Memory-sync deferred** to spec 006's close-out (after slice 006-03), to consolidate
  once per spec rather than three times across near-identical slices.

### Reconciliation sweep

- `docs/architecture.md` — **updated** (Source libraries bullet now names
  `scripts/lib/meetings/**`).
- `docs/decisions/` (ADR-0008) — **no-op**; ADR-0008 is Accepted and this slice
  realizes it without needing any further ADR (dedup-key choice is implementation-level,
  reasoned above).
- `docs/conventions.md` — **no-op**; no new project-wide convention introduced beyond
  the existing `scripts/lib/**` pure-module pattern already established (e.g. GitHub
  helpers).
- `docs/inbox.md` — **no-op**; checked, empty.
- `skills/morning-outlook/SKILL.md` — **deferred**; still describes the pre-ADR-0008
  pipeline, intentionally left alone until 006-02/006-03 replace the relevant sections
  (see deviation log above for rationale).
- `docs/refinement-todo.md` — **no-op**; the one relevant entry ("Outlook and meeting
  artifact access") was already resolved by ADR-0008 prior to this slice.
- Memory (`docs/memory/`, `/jig:memory-sync`) — **deferred** to spec 006 close-out
  (after 006-03), to run once per spec rather than per slice.

