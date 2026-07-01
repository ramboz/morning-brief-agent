---
status: DONE
dependencies: []
last_verified: 2026-07-01
arch_review: true
---

## Slice 004-01 - bounded-digest-and-triage

**Goal:** Generate a Slack daily digest and personal triage section from an
explicitly configured or user-provided scope.

**DoR:**
- [x] Slack plugin tools are available in the active Codex session. (Claude Code equivalent: the connected Slack MCP server's `slack_*` tools.)
- [x] Candidate channels, DMs, people, or topics are known. (`config/slack.json`, derived from a 60-day `from:me` activity search, confirmed with the user.)

**Acceptance Criteria:**

1. **Scope is explicit.** The workflow does not claim workspace-wide coverage
   unless the plugin can actually provide it.
2. **Digest highlights decisions and blockers.** The output prioritizes asks,
   blockers, ownership changes, incidents, and deadlines.
3. **Personal triage is separated.** Items needing the user's reply or action
   are distinguishable from "worth skimming" items.

**DoD:**
- [x] A sample digest/triage output is captured in the spec close-out. See [sample-digest-2026-07-01.md](sample-digest-2026-07-01.md) — a real (not mocked) run against the confirmed scope.
- [x] Coverage gaps are noted rather than hidden. See the Coverage section of the sample digest.

**Anti-horizontal-phasing check:** The user gets a Slack section they can act on
without reading channel history manually.

### Deviation log (after reconciliation)

- **Scope discovery via activity search, not a hand-typed config.** The DoR item "candidate channels, DMs, people, or topics are known" wasn't pre-existing — there was no real `config/slack.json`, only the placeholder example. Rather than ask the user to type a channel list cold, resolved it by searching their own `from:me` Slack activity over an escalating window (8 days → 60 days, per user request) and having them confirm/trim the discovered scope. This is a reusable pattern worth calling out: **AC1's "scope is explicit" is satisfied by deriving scope from evidence and confirming it, not just by accepting whatever the user types.**
- **AEM oncall dropped from scope.** `#autosky` and shift-dated `#skyline-oncall-*` channels showed up in the 60-day activity search but were explicitly excluded per user decision — oncall channels are ephemeral/rotational (a new channel per shift), so a fixed name in config goes stale immediately. This is noted in `config/slack.json`'s `note` field and in the sample digest's Coverage section, not silently dropped.
- **`slack_read_channel` doesn't return `permalink`.** Discovered while building the real sample — only `slack_search_public_and_private` returns a `permalink` field directly. Verified that `https://adobe.enterprise.slack.com/archives/<channel_id>/p<ts with dot removed>` reconstructs the same real permalink (cross-checked against ones returned by search), and documented that construction rule in `skills/morning-slack/SKILL.md` Step 1 rather than routing every cited message through an extra search call.
- **14 of the 23 configured people were not resolved to Slack IDs in this run.** To keep the first real run bounded, only people already surfaced with a known DM/group-DM ID during scope discovery were read. The remaining names are listed as "not resolved" in the sample's Coverage section rather than silently skipped — resolving them via `slack_search_users` is straightforward future work, not a design gap.
- **Draft staging (Step 3) intentionally untouched.** Slice 004-01 is gather+triage only; the existing DM-to-self draft mechanism (ADR-0002) stays as-is, with a note pointing at slice 004-02/ADR-0005 for the native-draft upgrade path.
- **Compliance-review fixes (scope leak + miscount).** The compliance pass caught two real issues in the first draft of this close-out, both now fixed: (1) the sample digest's Coverage line named a group DM (Yaman Kumar/Olena Orobei) that includes a person not in `config/slack.json` — reading it during scope discovery was fine, but citing it in the final digest as "in-scope quiet coverage" was a genuine scope leak against the workflow's own "never expand beyond `sections`" rule. Fixed by dropping that group DM from Coverage and moving Olena Orobei to "not resolved" (her own DM/ID was never actually checked). (2) The deviation log originally said "13 of the 21 configured people" — the config actually lists 23 people (3+4+8+8); corrected to "14 of the 23" after removing Olena Orobei from the resolved count.
- **`config/slack.json` gitignore status confirmed, not just assumed.** The compliance pass flagged that a config file with real coworker names must not be committed. Verified directly: `git check-ignore -v config/slack.json` → matched by `.gitignore:4` (`config/*.json`); `git status --short config/` shows only `config/slack.example.json` as a tracked change. No PII/secrets-hygiene regression.
- **Resolved two refinement-todo entries this slice was the trigger for.** The arch pass flagged that `docs/refinement-todo.md`'s "Decision: Slack plugin versus Slack scripts" (resolution trigger: "Slack daily triage spec" — this spec) and "Decision: Legacy Cowork skill layer" (resolution trigger: "First source-area spec that overlaps an existing legacy skill" — also this spec, via `skills/morning-slack/SKILL.md`) were both still open. Resolved both in `docs/refinement-todo.md`: plugin-first with scripts/browser as fallback (matches the implementation), and `skills/**` stays the live surface for sources needing an interactive plugin session (Slack) while `scripts/write-brief.js` stays the separate headless composer (AI Radar today) — the two are explicitly not wired together yet, with a named follow-up trigger for when they need to be. Added a one-line pointer to this fork directly in `skills/morning-slack/SKILL.md` per the arch re-review's nit, so it's discoverable from the skill itself, not just from process docs.
- **Craft-pass nits addressed (corrected on second pass).** (1) `skills/morning-slack/SKILL.md`'s permalink-construction rule now covers both public channel IDs and DM channel IDs (`D...`) explicitly under one construction rule. (2) The first fix attempt only edited the sample digest, not the SKILL.md contract itself — a follow-up craft re-review caught that the Coverage-line rule (Step 1 tracking, Step 2 analysis, Output rule 5, and the worked example) still only defined "quiet"/"unresolved". Corrected properly this time: SKILL.md now defines four tracked states (quiet / active-outside-window / unresolved / excluded-by-design) in all three places, and the worked example shows all four.

### Reconciliation sweep

- **`docs/architecture.md`** — no-op on Module boundaries (`skills/**` "may become reference material," `scripts/write-brief.js` as the brief composer already described this exact fork before this slice). **Updated on Contract surfaces** (caught by the reconciliation review, initially missed): this slice touches the two declared-but-not-yet-formalized surfaces "Config files" and "Markdown digest sections" (`config/slack.json`'s new `people` field; the new Needs-reply/Worth-skimming/Coverage digest shape). No JSON Schema/fixture was added — see the new interim note in `docs/refinement-todo.md`'s "Decision: Contract artifacts" entry, which already covers exactly this trigger ("first spec that changes a config shape or Markdown section format") and defers formal artifacts to spec `008-02` as prior slices have done.
- **`docs/refinement-todo.md`** — updated. Resolved "Slack plugin versus Slack scripts" and "Legacy Cowork skill layer," both of which named this spec/slice as their trigger (see deviation log above); also added the Contract-artifacts interim note above.
- **`docs/specs/README.md`** — updated. Regenerated via `workflow.py status-board` after merging `origin/main` (which had independently landed spec 003-03 in the meantime); board now shows both 003-03 DONE and 004-01's current status correctly.
- **`docs/decisions/adr-0005-slack-plugin-native-drafts.md`** — no-op. This slice implements ADR-0005's gather/digest recommendation but the ADR's core decision point (native drafts) is untouched and stays `Proposed`, gating slice 004-02 as designed. No ADR status change needed here.
- **`docs/conventions.md`** — no-op. The config `people` field is a natural extension of the existing `channels`-array convention, not a new rule.
- **`docs/inbox.md`** — no-op. Empty at slice start; nothing to sweep.
- **`docs/memory/learnings.md`** — updated. Added the `slack_read_channel` permalink gap and the review-verdict self-override guardrail (see below).

