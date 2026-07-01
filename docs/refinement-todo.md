> Status: Draft (revival baseline)
>
> Decisions the setup and revival pass explicitly deferred. Resolve hard-to-reverse
> choices by writing an ADR and linking it here.

# Refinement Todo: morning-brief-agent

## Architecture

### Resolved: Scheduled run mechanism
**Resolved by:** ADR-0006 and spec `003`, slice `003-02`.
**Resolution:** Use Codex automations as the scheduled-run mechanism for the
revived Daily Brief while keeping `node scripts/write-brief.js --brief`
manually runnable for debugging and future portability.
**Interim note (2026-06-18):** Slice `003-01` introduced the manual
`write-brief.js` daily note writer and intentionally left the scheduling
mechanism to `003-02`.
**Reconciliation note (2026-06-19):** The manual writer shells out to the live
AI Radar fetcher without a timeout. Scheduler/failure-reporting slices should
add hung-source isolation before unattended runs.
**Interim note (2026-07-01):** Slice `003-03` added per-source last-run state
(`scripts/lib/brief/state.js`, `logs/brief-state.json`) so failed sources
persist last-success time and a consecutive-failure streak, surfaced in the
rendered note's Source Results footer. Hung-source timeout isolation was
explicitly out of scope for `003-03` and remains unresolved — the AI Radar
subprocess call in `scripts/lib/brief/ai-radar.js` still has no timeout.

### Decision: Outlook and meeting artifact access
**Deferred:** Outlook email, calendar, Teams transcripts, recap emails, and recording-only links still need a confirmed access path.
**Current options:** M365/Outlook connector if available; Microsoft Graph scripts; browser fallback for unavailable artifacts.
**Resolution trigger:** First spec that revisits Outlook or meeting summaries.

### Resolved: Legacy Cowork skill layer
**Resolved by:** Spec `004`, slice `004-01` — the first source-area spec to
touch an existing legacy skill (`skills/morning-slack/SKILL.md`).
**Resolution:** Keep `skills/**` as the live surface for sources that need an
interactive agentic session with plugin/MCP tool access (Slack's `slack_*`
tools require a running session — they cannot be shelled out to headlessly).
`scripts/write-brief.js` stays the separate headless Node composer for
sources that can run unattended (AI Radar today). The two are not yet wired
together: `write-brief.js`'s `DEFAULT_SOURCES` does not include Slack, and
slice 004-01 does not add it. This is a real fork worth tracking, not an
oversight — resolving how (or whether) an interactive-session output like the
Slack digest should compose into the headless daily-note writer is deferred
to whichever future slice needs the two brief outputs unified.
**Resolution trigger for the follow-up:** A slice that needs the
`skills/**`-produced digest and the `write-brief.js`-produced note to appear
in the same daily artifact.

### Decision: Contract artifacts
**Deferred:** The architecture now names CLI output, config, and Markdown digest contracts, but formal schemas are not committed.
**Current options:** Add JSON Schema for script envelopes and config; rely on fixtures for Markdown render contracts; keep prose-only until a contract changes.
**Resolution trigger:** First spec that changes a script envelope, config shape, or Markdown section format.
**Interim note (2026-06-18):** Slice `002-01` changed AI Radar config examples, CLI stats/warnings, and the Markdown footer. Formal contract artifacts remain deferred to spec `008-02`; slice `002-02` is the immediate fixture-backed check for the AI Radar output shape.
**Interim note (2026-06-18):** Slice `002-03` changed the AI Radar action
layer Markdown contract. The checked-in fixtures now cover both an actionable
digest and quiet-day fallback; formal schemas/snapshot automation remain
deferred to spec `008-02`.
**Interim note (2026-06-18):** Slice `003-01` introduced the Daily Brief
composition envelope and Markdown note shape. Focused helper tests and a
fixture-backed smoke run cover the initial behavior; formal schemas/snapshots
remain deferred to spec `008-02`.
**Interim note (2026-07-01):** Slice `004-01` changed the `config/slack.json`
shape (added `sections[].people`) and introduced a new Markdown digest
contract (Needs-your-reply/Worth-skimming/Coverage sections, four tracked
coverage states) in `skills/morning-slack/SKILL.md`. No fixture snapshot was
added under `tests/fixtures/` for this shape — unlike the AI Radar precedent
— since this digest is produced by an interactive-session skill, not a
scriptable fetcher with a natural unit-test seam; a real sample run is
captured instead at `docs/specs/004-slack-plugin-triage/sample-digest-2026-07-01.md`.
Formal schemas/snapshot automation remain deferred to spec `008-02` per the
existing decision.
**Interim note (2026-07-01):** Slice `004-02` added the `draft_enabled`
field to `config/slack.json`'s shape and a new "Staged Drafts" Markdown
digest section in `skills/morning-slack/SKILL.md`. Same disposition as
004-01: no fixture snapshot (interactive-session skill, not a scriptable
fetcher); real test evidence captured instead at
`docs/specs/004-slack-plugin-triage/slice-02-draft-test-2026-07-01.md`.
Formal schemas/snapshots remain deferred to spec `008-02`.
**Reconciliation note (2026-06-19):** Source heading nesting is intentionally
plain string rewriting for the first source. Harden Markdown nesting when a
later source emits fenced code or literal `#` lines, or when formal snapshots
land in spec `008-02`.

## Source Slices

### Resolved: Slack plugin versus Slack scripts
**Resolved by:** Spec `004`, slice `004-01` (the "Slack daily triage spec").
**Resolution:** Plugin-first — `skills/morning-slack/SKILL.md` now gathers via
the Slack plugin's `slack_*` tools against an explicit, user-confirmed scope
(`config/slack.json`). `scripts/fetch-slack.js` and browser navigation stay as
fallback paths, tried in that order when the plugin is unavailable; slice
004-03 owns documenting that fallback boundary in full. Native Slack drafts
(vs. the current DM-to-self mechanism) remain gated on ADR-0005 acceptance
and slice 004-02.
**Interim note (2026-07-01):** Both have now landed. ADR-0005 was Accepted
(Option B) and slice `004-02` implemented native Slack drafts via
`slack_send_message_draft`, gated on `config/slack.json`'s `draft_enabled`
(default `false`). ADR-002's Slack delivery row is marked superseded (Slack
only — JIRA/GitHub/Confluence rows there are unaffected). See slice 004-02's
deviation log for what was and wasn't live-tested.
**Closing note (2026-07-01):** Slice `004-03` closed the loop. `scripts/fetch-slack.js`
stays as the documented gather-only fallback (broader DM scope than the
plugin path — see `docs/architecture.md`'s "Slack: Plugin-First With Bounded
Fallbacks"). `scripts/stage-slack-draft.js` was deleted — fully superseded by
native drafts, with no remaining fallback need. `skills/morning-assistant/SKILL.md`'s
Step 4 (which independently re-implemented a Slack enrich/draft/stage pass)
was updated to defer to `morning-slack`'s own native-draft Step 3 instead of
duplicating it. Once slice `004-03`'s own lifecycle transition lands (review
gate → reconciliation → DONE), spec `004` will have all 3 slices DONE and can
be considered closed. One residual gap
found but explicitly left out of scope: `config/main.example.json`'s
`tools.slack.gather_method`/`gather_fallback` fields (`"script"`/`"connector"`)
still reflect the pre-plugin gather taxonomy and don't model the plugin as a
gather method at all — `morning-slack/SKILL.md` doesn't consult those fields.
Left for spec `008`'s script-and-config-contracts slice, which is already
scoped to reconcile config/script contracts. A second residual gap: the root
`CLAUDE.md` (legacy project bible, out of scope for this slice's deliverable
list) still references `stage-slack-draft.js` at its per-tool Draft column
and its Draft delivery rule paragraph — left for spec `008`'s legacy-Cowork-doc
triage slice rather than touched here.

### Decision: GitHub PR review staging policy
**Deferred:** Automatic PR detection is desirable, but staging behavior should be explicit.
**Current options:** Write reviews only to Obsidian/output; create pending GitHub reviews when enabled per repo; require manual trigger for staging.
**Resolution trigger:** GitHub PR review automation spec.

### Resolved: AI Radar source list
**Resolved by:** Spec `002`, slice `002-01`.
**Resolution:** AI Radar v1 keeps a small enabled default source list and leaves broader, static, paper, newsletter, social/trending, and trend-engine examples disabled with explicit `deferred_reason` notes.

## Operations

### Decision: CI/CD setup
**Deferred:** No CI is currently configured.
**Current options:** Stay local-only for now; add a lightweight CI check for fixtures/lint; add CI after the first non-trivial code change.
**Resolution trigger:** First slice that introduces meaningful test automation.

### Decision: Test strategy
**Deferred:** The repo has fixtures but no real package test command.
**Current options:** Fixture snapshot checks for renderers; script smoke tests; targeted unit tests around shared helpers.
**Resolution trigger:** First slice that requires committed test automation beyond fixture snapshots and targeted script checks.
**Interim note (2026-06-18):** Slice `002-01` used a targeted script smoke run because no pytest/vitest/jest runner is configured. Slice `002-02` owns refreshing `tests/fixtures/ai-radar.*` from the real trimmed run.
**Interim note (2026-06-18):** Slice `002-03` changed AI Radar rendering and
used renderer-focused Node checks plus refreshed Markdown/JSON fixtures instead
of introducing a package-level test command. The repo still has no committed
pytest/vitest/jest runner.
**Interim note (2026-06-18):** Slice `003-01` introduced a dependency-free
Node test command (`npm test` / `.jig/test-command`) for focused helper tests.
A broader CI policy remains deferred.
**Reconciliation note (2026-06-19):** CLI envelope/wiring tests remain a
follow-up; this slice verifies the CLI path with a fixture-backed smoke run.
