# Learnings

> Status: Draft (wizard-generated)
>
> Dead ends, failed approaches, and "we tried X and here's why it didn't work."
> The institutional memory that ADRs don't capture — these are not decisions,
> they're anti-patterns and gotchas discovered in practice.
>
> Update via `/jig:memory-sync` during reconciliation.

<!-- Learnings below. Format: ## Title, followed by what happened and what to do instead. -->

## Slack plugin's `slack_read_channel`/`slack_read_thread` don't return `permalink`

Only `slack_search_public_and_private` returns a `permalink` field directly.
`slack_read_channel` and `slack_read_thread` give you `channel_id` and
`Message TS` but no permalink. Reconstruct it as
`https://adobe.enterprise.slack.com/archives/<channel_id>/p<message_ts with
the dot removed>` — verified against real search-returned permalinks, and
identical for public/private channel IDs (`C...`) and DM/group-DM channel
IDs (`D...`). See `skills/morning-slack/SKILL.md` (spec 004-01).

## Slack plugin's `slack_send_message_draft` doesn't reproduce `draft_already_exists` for a self-DM

The tool's own docs say "only one attached draft is allowed per channel —
`draft_already_exists` otherwise." Live testing against the user's own
self-DM (`spec 004-02`) called it four times (three unthreaded, one
`thread_ts`-threaded) and never got that error — the unthreaded calls
silently updated the same attached draft in place (`draft_id` present on
the first call, absent on repeats), while the threaded call got its own
distinct `draft_id` that didn't collide with the unthreaded one. Two
takeaways: (1) don't assume `draft_already_exists` is reproducible in a
self-DM when testing draft-conflict handling — test the *code path*
against the tool's documented contract, not against an observed self-DM
repro, since one may never come; (2) "one attached draft per channel"
appears scoped to the unthreaded slot — a threaded reply draft is tracked
separately. See `docs/specs/004-slack-plugin-triage/slice-02-draft-test-2026-07-01.md`.

## Run `workflow.py status-board` after the frontmatter transition, not before

Regenerating the status board before running `workflow.py transition` bakes
in the pre-transition status, leaving the board transiently stale until the
next regen. Order matters: transition first, then regen — not the other
way around. Caught during slice 004-02's reconciliation review.

## Don't self-override an independent reviewer's verdict, even when the rule justifying it is real

During spec 004-01's craft-pass review, the reviewer returned `needs-changes`
with only `[nit]`-tagged findings (no `[blocker]`s). jig's spec-workflow
SKILL.md documents that `needs-changes` without a blocker doesn't block the
`REVIEWED` transition — but attempting to *record* that pass as `pass`
myself (reasoning from the documented rule) was blocked by the permission
system as "self-approval: overriding an independent reviewer's verdict."
Correct move: fix the flagged nits, then spawn a **fresh** independent
re-review and record whatever verdict *it* returns verbatim — never
translate a reviewer's literal verdict into a different one based on my own
reading of a gating rule, even when the rule is genuinely documented.

## Scheduled-run checks must read the JSON envelope, not the exit code

`scripts/write-brief.js` (`emitAndExit`) always calls `process.exit(0)`, even
for `ok:false` error envelopes. So any scheduled-run wrapper (Codex automation,
cron, future failure-state slice 003-03) that keys off the process exit code
will silently treat failed runs as successful. Instead, detect failure from the
JSON envelope: `ok` is false, top-level `errors` is non-empty, the output is
invalid JSON, or the command timed out. The 003-02 automation prompt
(`docs/operations/daily-brief-automation.md`) follows this pattern — reuse it.

## State-file I/O must self-guard against corrupt/unwritable files
scripts/lib/brief/state.js (loadBriefState/updateBriefState) was originally called unguarded from write-brief.js's main(). A corrupt logs/brief-state.json (bad JSON) or an unwritable logs/ directory would throw, propagate to main().catch(), and fail the entire brief run with ok:false — even when every actual source succeeded. This violates CLAUDE.md's Error Handling rule (every tool fails independently) and the slice's own AC1. Found during compliance/craft review of slice 003-03. Fixed by making both functions catch their own read/parse/write errors internally (console.error('[brief]', ...)) and always return a usable state object instead of throwing. Contrast with scripts/lib/ai-radar/state.js, whose loadSeenCache still throws on a non-ENOENT read error — that module is a single dedup cache read once at the top of a source-specific fetch, not a whole-run dependency, so the risk profile differs. Rule of thumb: any state/cache file read or written on the hot path of a multi-source run must never let an I/O/parse failure escalate past its own boundary.

## scripts/fetch-slack.js's DM fallback is broader than the plugin path, not narrower
scripts/fetch-slack.js (the gather fallback used when the Slack plugin is
unavailable) scopes channels to config/slack.json's sections[].channels,
matching the plugin path — but its DM/group-DM fetch uses
conversations.list({ types: 'im,mpim' }) unscoped by sections[].people, so it
reads every DM/group-DM the configured Slack token can see. The usual
assumption ("a fallback covers less than the primary path") is backwards here.
Found while satisfying slice 004-03's DoR ("understand fetch-slack.js's
behavior") before writing the fallback-boundary docs. Documented explicitly in
docs/architecture.md's "Slack: Plugin-First With Bounded Fallbacks" and
skills/morning-slack/SKILL.md's Step 1, rather than left as an implicit
surprise a future session would rediscover the hard way.

## Status-board regen must run at every transition, not deferred to a later one
A follow-up to "Run workflow.py status-board after the frontmatter transition,
not before" (same slice family, spec 004). During slice 004-03's
reconciliation review, docs/specs/README.md was found showing 004-03 as DRAFT
while the slice's own frontmatter had already progressed to REVIEWED — two
transitions (IN_PROGRESS, REVIEWED) had happened without an intervening
status-board regen, and the deviation-log sweep entry for README.md papered
over the gap by only promising a regen "after the DONE transition." The
reconciliation reviewer caught this by directly diffing the board against the
slice frontmatter rather than trusting the sweep's narrative. Rule: run
`workflow.py status-board` after *every* transition in a slice's lifecycle,
not just once at the end — and when a reconciliation sweep claims a board
entry will be "updated later," verify that claim against the board's current
actual content rather than accepting the promise at face value.

## `{scripts_path}/../config/<tool>.json` resolves to repo-root config/, but an isolated reader can misread it

Every source skill's "Load config" step reads `{scripts_path}/../config/<tool>.json`.
`{scripts_path}` is a config-provided value (from `config/main.json`, surfaced by
`skills/morning-assistant/SKILL.md`) equal to the repo's `scripts/` dir — so the
path resolves to the project-root `config/<tool>.json`, exactly what
`scripts/lib/config.js` (`CONFIG_DIR = repo-root config/`) loads. During slice
007-01's craft review, a fresh reviewer with only the SKILL in its reading set
misread `{scripts_path}` as the skill's own directory and flagged the path as a
`[blocker]` (a non-existent `skills/morning-jira/config/jira.json`); the arch
reviewer, which had checked against `config.js`, validated the same line as
correct. Takeaway: the placeholder is correct and house-wide (all 7 skills use
it), but it is ambiguous to an isolated reader — add a one-line inline
clarification in each source SKILL that it resolves to the project-root `config/`
(done for morning-jira; apply to confluence/github as they migrate). Don't
"fix" an isolated-reader misread by diverging from the convention.

## MCP-first source migration (spec 007): only the script fallback is verifiable offline

When migrating a source (Jira / Confluence / corp-GitHub) to MCP-first per
ADR-0004, the MCP tools live in the running Codex session, not in a Claude Code /
offline implementing session — and there are no real configs/creds committed. So
the MCP gather path cannot be live-tested during implementation; only the script
fallback (`node scripts/fetch-<tool>.js --brief` → `{ok:false, errors:[...]}`
graceful envelope) is offline-verifiable. Write the SKILL to target "the MCP tools
available in the running session" (mirroring how `morning-slack` references
`slack_*`), reference them by capability/operation rather than exact tool names,
and make the DoD sample honest: an explicitly-labeled illustrative format template
PLUS a real captured fallback-envelope run. This satisfies the AC "≥1 item OR a
clear no-results/unavailable note" without fabricating live MCP output. Leave the
DoR "MCP auth works" item unchecked with the reason noted, rather than tick it
dishonestly.

## Legacy pre-jig ADRs: `adr.py index` can't parse them (spec 008-01)

The two pre-jig ADRs (`adr-0001`/`adr-0002`) use `# ADR-001:` three-digit
headings and `**Status:** Accepted` prose, not the canonical `# ADR-NNNN:` +
`## Status` shape. `adr.py index`'s `_extract_title`/`_extract_status_and_date`
require the canonical shape, so it renders them "(untitled)"/"(unknown)" — you
**cannot** regenerate the decisions index with `adr.py index` while a legacy ADR
is present without a body rewrite. When a DoD forbids changing accepted ADR prose,
take the "or an equivalent manual index check" path: `git mv` to the canonical
`adr-000N-*.md` filename, hand-maintain those two index entries, and document the
deliberate filename-vs-heading digit difference. Also: `migrate.py
rename-decisions` only does the `docs/adrs/ → docs/decisions/` move — it will NOT
renumber `ADR-00N-*.md` files already in `docs/decisions/`.

## The script envelope `mode` is an open vocabulary, not `{brief, search}` (spec 008-02)

`CLAUDE.md` says scripts take `--brief`/`--search`, but `envelope()` is actually
called with a wider set across `scripts/`: `brief`, `search`, `context`, `draft`,
`index`, `cleanup`, `discard`, `list`, `stage`, `write`, `unknown`. The committed
contract `docs/contracts/script-envelope.schema.json` therefore types `mode` as an
open non-empty string (documented labels, not an `enum`) — an enum would reject the
majority of real envelopes. Lesson for any contract drift-locked to a producer:
exercise the test across the modes the producer *actually* emits (grep `envelope(`
call sites); a brief-only test hides the mismatch (this exact gap was caught by the
arch-review pass, not compliance/craft). Config contracts stay as
`config/*.example.json` examples for now (single-user tool, one consumer per
family) — rationale + revisit trigger in `docs/contracts/README.md`.

## Artifact-to-meeting matching by title-prefix needs closest-timestamp disambiguation, not first-match
scripts/lib/meetings/inventory.js matches transcripts/recordings/recap-emails to calendar meetings by normalized-title-prefix + time-window (an existing heuristic reused from fetch-outlook.js). Using Array.find (first-match-wins) silently misattaches an artifact when two same-day meetings share the same title prefix (e.g. two truncate to the same 20-char prefix) — caught independently by two review passes on slice 006-01, not by the original implementation or its first test suite. Fix: when multiple candidates pass the title+window filter, pick the one whose meeting start is closest in time to the artifact's own timestamp (see findMatchingMeeting()). Lesson for any similar fuzzy-matching code: if the match key can collide, add a same-day-collision test case explicitly — a single-candidate fixture will not catch first-match-wins bugs.

## Cross-tenant (externally-organized) meetings can't be resolved via Graph's onlineMeetings lookup
A live probe against Microsoft Graph (ADR-0008) found /me/onlineMeetings?$filter=JoinWebUrl resolves fine for internally-organized meetings but returns 403 for a meeting organized by an external company (tested: SAP-organized meeting). Teams attendance reports (/me/onlineMeetings/{id}/attendanceReports) also 403 unconditionally — even for internally-organized meetings — and would need OnlineMeetingArtifact.Read.All with tenant admin consent, not worth pursuing for a personal tool. Net effect: meeting-artifact discovery (scripts/lib/meetings/inventory.js) never uses calendar-based meeting-ID resolution — it matches artifacts to meetings by title+time only, uniformly for internal and external organizers, which is why cross-tenant meetings degrade gracefully instead of needing special-casing.

## Staleness/"open work" detection is the inverse of the lookback-bounded brief queries
Spec 009 (open-work radar) surfaces the user's own stalled work — open authored PRs and in-progress JIRA tickets that have gone quiet. Three durable lessons: (1) **Do NOT apply a lookback bound.** The existing brief queries filter to `updated >= -Nh` (recent activity); a *stale* item is precisely one that's been untouched, so `runInProgress`/`buildInProgressJql` (lib/jira/query.js) deliberately omit any time clause and query by `statusCategory = "In Progress"` (covers project-specific statuses like "In Review"), oldest-first. Reusing the brief's query would return the empty set for exactly the items you care about. (2) **Unknown age surfaces, never hides.** A missing/unparsable `updated_at`/`updated` classifies as very-stale (surfaced), not fresh (hidden) — `toMs` must guard `null`/`''` explicitly since `new Date(null)` is epoch 0, not Invalid Date. (3) **Scripts with `main()` at module load can't be imported** — put reusable fetch/format logic in side-effect-free libs (`lib/github.js`, `lib/jira/query.js`, pure `lib/github/open-prs.js` + `lib/jira/staleness.js`), and let thin `list-*.js` runners + the orchestrator compose them. Day-cadence (Monday full inventory vs weekday stale-only) is a pure rule in `lib/open-work.js` applied by the orchestrator. Also: authoring a spec off a stale local `main` (14 commits behind `origin/main`) meant a mid-implementation rebase — the rebase's schema-contract test (spec 008's ajv) caught the divergence; always confirm the branch base against `origin/main` before implementing, not just local `main`.
