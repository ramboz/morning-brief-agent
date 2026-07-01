---
status: DONE
dependencies: ["004-01"]
last_verified: 2026-07-01
arch_review: true
---

## Slice 004-02 - native-draft-workflow

**Goal:** Prepare Slack-native reply drafts for likely replies while preserving
the "never send unattended" safety rule.

**DoR:**
- [x] ADR-0005 is accepted or explicitly approved for this slice. (Accepted 2026-07-01, Option B — user confirmed directly.)
- [x] Slack plugin draft tools are available and authenticated. (`slack_send_message_draft` tool confirmed loaded; see DoD test below for a live, authenticated call.)

**Acceptance Criteria:**

1. **Drafts are review-first.** The workflow creates Slack drafts only when the
   user has enabled draft behavior or requested it.
2. **Drafts preserve context.** Each draft links or points back to the source
   channel, DM, or thread.
3. **Existing draft conflicts are safe.** If Slack reports an attached draft
   already exists, the workflow stops and reports that it cannot overwrite it.

**DoD:**
- [x] Draft behavior is tested in a low-risk destination or dry-run equivalent. See [slice-02-draft-test-2026-07-01.md](slice-02-draft-test-2026-07-01.md) — real (not mocked) `slack_send_message_draft` calls against the user's own self-DM covering both the unthreaded-create and `thread_ts`-threaded-reply paths (AC2). The `draft_already_exists` conflict path (AC3) is *not* reproduced by this test — self-DM calls never triggered it — and is implemented per the tool's own documented behavior rather than by observed reproduction; see the deviation log.
- [x] Daily note output surfaces draft links or draft status. See `skills/morning-slack/SKILL.md`'s "Staged Drafts" output rule and worked example.

**Anti-horizontal-phasing check:** The user has a reviewable Slack draft ready
where the conversation is happening, without the assistant sending it.

### Deviation log (after reconciliation)

- **`draft_enabled` defaults to `false`.** ADR-0005's own open question ("Should Slack drafts be disabled by default until the user approves a scope?") is answered here: yes. `config/slack.json` and `config/slack.example.json` both ship with `draft_enabled: false` — AC1's "only when explicitly enabled" is enforced as a hard gate in `skills/morning-slack/SKILL.md` Step 3, not a soft default.
- **DM-to-self mechanism removed from the active skill, not deleted from the repo.** `scripts/stage-slack-draft.js` is no longer called by `skills/morning-slack/SKILL.md` (superseded by ADR-0005 for Slack specifically — see the ADR-002 amendment). The script itself is left in place; whether to delete it is explicitly deferred to slice 004-03's fallback/dead-code decision, not decided here.
- **`draft_already_exists` could not be reproduced in the one destination safe enough to test (self-DM).** Three consecutive unthreaded `slack_send_message_draft` calls to the user's own self-DM all succeeded — no conflict error, though the second and third calls dropped the `draft_id` field present on the first, suggesting an in-place update rather than a genuine "no conflict" case. See `slice-02-draft-test-2026-07-01.md` for the full evidence and reasoning on why this doesn't invalidate AC3 (the tool's own docs describe the conflict for a channel/DM shared with someone else, which a self-DM isn't). Documented as a caveat in SKILL.md §3c rather than glossed over.
- **Craft review caught an untested branch — fixed.** The first pass of this slice only tested the bare unthreaded create path, leaving AC2's `thread_ts` branch asserted but unverified. Fixed by drafting a threaded reply to a real prior self-DM message (a genuine 2025-06-12 message, not manufactured for the test). New finding: the threaded draft got its own `draft_id`, distinct from and not colliding with the unthreaded attached draft from the earlier calls — "one attached draft per channel" appears to be scoped to the unthreaded slot specifically, with threaded replies tracked per-thread. See the updated `slice-02-draft-test-2026-07-01.md` Call 4.
- **Two real (harmless) drafts were left in the user's own self-DM** from this testing — one unthreaded, one threaded. No delete-draft tool was available; the user can remove them manually in Slack (`https://adobe.enterprise.slack.com/archives/D19QPHQP2`) — neither was ever sent and both are visible only to them.
- **Context-preservation (AC2) uses `thread_ts` for threaded replies, a quoted permalink otherwise.** No separate "context enrichment" API call is needed (unlike the old ADR-002 DM-to-self flow's `fetch-slack.js --context` step) — Step 1's `slack_read_thread` already gathers what Step 3 needs. Both branches are now live-tested (see above).
- **Compliance/arch review caught two stale docs — fixed.** `docs/refinement-todo.md`'s "Resolved: Slack plugin versus Slack scripts" entry still described native drafts as gated on "ADR-0005 acceptance and slice 004-02" after both had actually happened; added an interim note there. The contract-surface concern (new `draft_enabled` config field, new "Staged Drafts" digest section) is handled the same way slice 004-01 handled it: an interim note on `docs/refinement-todo.md`'s "Decision: Contract artifacts" entry, not a direct edit to `docs/architecture.md` — `architecture.md` has never been edited by either slice; that's the established pattern for this project (confirmed via `git log -- docs/architecture.md`), so this slice follows it rather than deviating.
- **Cross-slice inconsistency found and corrected (closed-record amendment).** A second compliance re-review caught that this slice's claim above ("`architecture.md` has never been edited by either slice") directly contradicts slice 004-01's own reconciliation sweep, which says it "**Updated** on Contract surfaces." Since 004-01 is `DONE` (a closed record), the fix isn't to edit it in place — it's a dated `### Amendments` entry appended to `slice-01-bounded-digest-and-triage.md` clarifying that "Updated" meant "the concern was addressed via the refinement-todo.md interim note," not "architecture.md's file was edited" (which `git log` confirms never happened for either slice). This slice's own claim was accurate; 004-01's wording was the misleading one, and is now corrected per the closed-record amendment policy (dated note, not silent rewrite).
- **Cleanup reminder:** two harmless test drafts (one unthreaded, one threaded) remain in the user's own self-DM from this slice's testing — see the DoD/draft-test entries above. No delete-draft tool was available to remove them; flagging again here since compliance and craft reviews both separately noted it.

### Reconciliation sweep

- **`docs/architecture.md`** — no-op. No module boundary changed; the
  Contract-surfaces gap is handled via the `docs/refinement-todo.md` interim
  note (established pattern, not a direct edit — see above).
- **`docs/refinement-todo.md`** — updated. Added interim notes to "Resolved:
  Slack plugin versus Slack scripts" (native drafts landed) and "Decision:
  Contract artifacts" (config/digest shape changes, fixture deferred).
- **`docs/specs/README.md`** — updated via `workflow.py status-board`. The
  reconciliation review caught that this regen happened *before* the
  `REVIEWED` transition, so the board briefly still showed `IN_PROGRESS`
  after the sweep claimed "updated" — re-ran the regen after the
  transition; the row now correctly shows `REVIEWED`.
- **`docs/decisions/ADR-002-draft-generation-and-delivery.md`** — updated
  (the one edit an Accepted ADR is allowed: an appended supersession note,
  Slack row only — see the deviation log above).
- **`docs/decisions/adr-0005-slack-plugin-native-drafts.md`** — updated via
  `adr.py accept` (Proposed → Accepted), immutability preserved (no other
  prose edited).
- **`docs/conventions.md`** — no-op. `draft_enabled` is a natural extension
  of the existing boolean-flag config convention (`emoji_triage.enabled`,
  `ignore_bots`), not a new rule.
- **`docs/inbox.md`** — no-op. Empty; nothing to sweep.
- **`docs/memory/learnings.md`** — updated (see below): the self-DM
  `draft_already_exists` non-reproduction and the threaded-vs-unthreaded
  draft-slot finding are both new, surprising, load-bearing discoveries
  worth persisting.

