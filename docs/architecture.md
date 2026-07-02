> Status: Draft (revival baseline)
>
> Technical mechanics. Vision and design principles live in
> [product-vision.md](product-vision.md). Update via reconciliation after each
> spec slice completes.

# Architecture: morning-brief-agent

> For what this project is, who it is for, and why, see
> [product-vision.md](product-vision.md). This document covers the technical
> mechanics: repository structure, tech stack, decisions, modules, data, and
> contract surfaces.

## Repository structure

<!-- elicited: 2026-06-18 / status: filled -->

```
morning-brief-agent/
├── .codex/                  # jig runtime machinery for Codex: skills, agents, hooks
├── .jig/                    # jig scaffold markers
├── config/                  # committed example configs; real personal configs are ignored
├── docs/                    # jig docs, ADRs, memory, and project vision/architecture
├── docs/specs/              # active jig specs and status board
├── docs/decisions/          # architectural decision records
├── scripts/                 # standalone Node.js helper scripts and source fetchers
├── scripts/lib/             # small shared script helpers
├── skills/                  # legacy Cowork/Codex-style source-area skills
├── specs/                   # legacy v1 specs retained as reference inputs
├── tests/fixtures/          # reproducible checked-in fixtures
├── AGENTS.md                # current project instructions and hot cache
├── CLAUDE.md                # legacy project bible; reference until migrated
├── README.md                # public overview / historical getting-started doc
├── package.json             # Node.js package metadata and script shortcuts
└── scaffold.json            # jig scaffold state
```

## Tech stack

<!-- elicited: 2026-06-18 / status: filled -->

- **Runtime / language:** Node.js 20+, native ESM, plain JavaScript.
- **Package manager:** npm with checked-in `package-lock.json`.
- **Primary output:** Markdown files for Obsidian, plus JSON fixtures and latest-output files where useful.
- **State:** local config files, caches, fixture files, and generated output; no database in v1.
- **Developer workflow:** Codex + jig specs in this repo.
- **Integration strategy:** MCP tools and Codex plugins first when available; fallback to helper scripts for source areas without reliable connector coverage.
- **Current important integrations:**
  - Slack plugin for digest, notification triage, and native draft workflows
    (primary path — see "Slack: Plugin-First With Bounded Fallbacks" below
    for the fallback boundary).
  - Corporate GitHub MCP tools for PRs, files, reviews, failed jobs, and logs.
  - Jira MCP tools for search, comments, transitions, and issue metadata.
  - Confluence/wiki MCP tools for page search/read/update capability; project policy keeps Confluence read-only unless a spec changes that.
  - Existing Node scripts for AI Radar, Outlook/meetings, GitHub API fallback, Slack fallback, Jira, and Confluence.
- **Locked-in decisions:**
  - Script-first implementation.
  - Markdown-first output.
  - Safety constraints: review-first, no automatic sends or irreversible tool actions.
  - No web app or database for current scope.
- **Still open:**
  - Outlook/M365 connector versus Graph script versus browser fallback.
  - How much of the legacy Cowork skill layer remains active.
- **Resolved:**
  - GitHub PR review staging policy — [ADR-0007](decisions/adr-0007-review-first-github-pr-automation.md) (spec 005): reviews are written to local artifacts by default (`output/github-reviews/`); native GitHub *pending*-review staging is opt-in per repo/run and never submits.

## Core architecture decisions

### Markdown-First Daily Output

**Principle:** The daily result should be useful to read, easy to inspect, and easy to diff.

**Mechanics:** Source slices render Obsidian-ready Markdown sections. JSON envelopes and fixtures remain available for debugging and reproducibility.

### MCP / Plugin First, Scripts As Fallbacks

**Principle:** Do not keep custom API logic where a reliable tool surface already exists.

**Mechanics:** Slack, Jira, Confluence, and corporate GitHub should move toward MCP/plugin-backed source slices. Existing scripts stay as fallbacks or fixtures until a spec supersedes them.

### Slack: Plugin-First With Bounded Fallbacks

**Principle:** A fallback earns its place by covering a gap the primary path
can't; it should never grow a second, competing implementation of the same
capability.

**Mechanics (spec `004`, documented by slice `004-03`):**
- **Gather (primary):** the Slack plugin's `slack_*` tools, scoped to
  `config/slack.json`'s `sections[].channels`/`sections[].people`.
- **Gather (fallback):** `scripts/fetch-slack.js --brief`/`--search`, tried
  only when the plugin is unavailable. Its channel scope matches the plugin
  path, but its DM/group-DM fetch is **broader** — it reads every DM the
  configured Slack token can see, not just `sections[].people` — so fallback
  coverage is not a strict subset of the plugin path. `skills/morning-slack/SKILL.md`
  reports which path ran each time; never assume it silently.
- **Gather (last resort):** browser navigation to `https://app.slack.com` via
  Claude in Chrome, read-only.
- **Draft (primary and only path):** native Slack drafts via
  `slack_send_message_draft` ([ADR-0005](../decisions/adr-0005-slack-plugin-native-drafts.md)),
  gated on `config/slack.json`'s `draft_enabled`. There is **no draft
  fallback** — `scripts/stage-slack-draft.js` (the old DM-to-self mechanism)
  was retired in slice `004-03` once native drafts fully superseded it and no
  concrete need for a second drafting path remained. If the plugin is
  unavailable for gather, drafting is skipped for that run, not rerouted to a
  legacy mechanism.
- **Coverage is always user-facing:** the daily note's Slack section reports
  which gather path ran and which `sections` entries were quiet, active
  outside the lookback window, unresolved, or excluded by design — see
  `skills/morning-slack/SKILL.md`'s Coverage section format.

### Jira: MCP-First With Bounded Fallbacks

**Principle:** A fallback earns its place by covering a gap the primary path
can't; it should never grow a second, competing implementation of the same
capability.

**Mechanics (spec `007`, documented by slice `007-01`):**
- **Gather (primary):** the Jira MCP tools available in the running session,
  using issue-search for the three-pass scan (assigned / commented / mentioned)
  and issue-read for full-ticket context. Scoped to `config/jira.json`'s
  `projects`.
- **Gather (fallback):** `scripts/fetch-jira.js --brief`/`--search`/`--context`,
  tried only when the MCP tools are unavailable. It runs the same three-pass
  JQL scan over the same `projects` scope and emits the standard envelope
  `{ ok, tool, mode, timestamp, data, errors }`; on `ok: false` the Jira
  section reports "unavailable — <reason>" rather than failing silently.
  `skills/morning-jira/SKILL.md` reports which path ran each time; never
  assume it silently.
- **Gather (last resort):** browser navigation to the JIRA web UI via Claude in
  Chrome, read-only ("My Issues", recent activity, notification bell).
- **Draft (single path across all gather paths):** local Markdown fragments via
  `scripts/stage-local-draft.js` ([ADR-002](decisions/adr-0002-draft-generation-and-delivery.md)),
  gated on `config/jira.json`'s `draft_enabled`. JIRA has no comment-draft
  persistence, so no browser or MCP drafting is used; the local-MD path does
  not depend on the MCP tools and still runs after a script-fallback gather.
- **Read-only / never-change-status guarantee:** the workflow never changes a
  Jira status, transitions an issue, or adds a comment directly into Jira (no
  MCP comment-add, no browser submit). All reply staging is local-MD fragments
  surfaced in the daily note for human review — see
  [Review-First Safety](#review-first-safety) below.
- **Coverage is always user-facing:** the daily note's Jira section reports
  which gather path ran and which configured projects were quiet, active
  outside the lookback window, or unreachable — see
  `skills/morning-jira/SKILL.md`'s Coverage section format.

### Confluence: MCP-First With Bounded Fallbacks

**Principle:** A fallback earns its place by covering a gap the primary path
can't; it should never grow a second, competing implementation of the same
capability.

**Mechanics (spec `007`, documented by slice `007-02`):**
- **Gather (primary):** the Confluence/wiki MCP tools available in the running
  session, using page-search for recently-modified watched pages and
  mention/search hits, and page-read for full page/comment context. Scoped to
  `config/confluence.json`'s `spaces`.
- **Gather (fallback):** `scripts/fetch-confluence.js --brief`/`--search`,
  tried only when the MCP tools are unavailable. It runs the same two-pass scan
  (recently-modified pages + mention comments) over the same `spaces` scope,
  applies the config pre-filters (`exclude_title_patterns`,
  `skip_if_only_mentions` + `my_context_keywords`, `min_change_chars`), enriches
  each page with a `changeSummary`/`totalChange`, and emits the standard
  envelope `{ ok, tool, mode, timestamp, data, errors }`; on `ok: false` the
  Confluence section reports "unavailable — <reason>" rather than failing
  silently. `skills/morning-confluence/SKILL.md` reports which path ran each
  time; never assume it silently.
- **Gather (last resort):** browser navigation to the Confluence web UI via
  Claude in Chrome, read-only ("Recently Updated" per watched space,
  notification bell for @mentions).
- **Read-only guarantee (no drafts):** Confluence is strictly read-only in this
  project — the workflow never edits a page, never adds a comment (no MCP
  page/comment write, no browser submit), and stages **no draft** of any kind.
  There is no drafting step for Confluence: the earlier local-MD comment-draft
  path (`stage-local-draft.js`) was removed in slice `007-02` as a policy
  alignment, since Confluence output is gather + triage + render only — see
  [Review-First Safety](#review-first-safety) below.
- **Minimal state:** page-version tracking is a plain, inspectable JSON file
  (`~/.claude/skills/morning-assistant/state/wiki-state.json`) — a `lastRun`
  timestamp and a page id → version map. No database, no complex state; the next
  run diffs against it to compute change summaries.
- **Coverage is always user-facing:** the daily note's Confluence section
  reports which gather path ran and which configured spaces were quiet, active
  outside the lookback window, or unreachable — see
  `skills/morning-confluence/SKILL.md`'s Coverage section format.

### Corporate GitHub: MCP-First With Bounded Fallbacks

**Principle:** A fallback earns its place by covering a gap the primary path
can't; it should never grow a second, competing implementation of the same
capability.

**Scope note:** this subsection covers the **corporate** GitHub instance only.
The github.com instance is unchanged — it stays on the Cowork GitHub connector
with `scripts/fetch-github-com.js` as its script fallback. Slice `007-03`
migrated only the corporate gather path to MCP-first.

**Mechanics (spec `007`, documented by slice `007-03`):**
- **Gather (primary):** the corporate GitHub MCP tools available in the running
  session, using notification-list for review requests / mentions / assignments
  / authored-PR activity, PR-list + PR-context/diff/checks for review-requested
  and authored PRs, check-runs / Prow-job status for failed CI, and issue-read
  for mentioned/assigned issues. Scoped to `config/github.json`'s
  `github_corp.orgs`.
- **Gather (fallback):** `scripts/fetch-github-corp.js --brief`/`--search`/`--context`,
  tried only when the corp MCP tools are unavailable. It runs the same
  notification + PR/issue + failed-check scan over the same `github_corp.orgs`
  scope and emits the standard envelope
  `{ ok, tool, mode, timestamp, data, errors }`; on `ok: false` the Corporate
  GitHub section reports "unavailable — <reason>" rather than failing silently.
  `skills/morning-github/SKILL.md` reports which path ran each time; never
  assume it silently. The fallback is a documented subset of the primary path,
  not a second, competing implementation.
- **Gather (last resort):** browser navigation to the corporate GitHub web UI
  via Claude in Chrome, read-only (notifications inbox, review-request queue,
  your open PRs).
- **Failed jobs are actionable:** failed CI / Prow items carry the failing job
  name(s) and a link to the run (or checks tab), so the user can decide whether
  to investigate without a bare "CI failing".
- **Read-first guarantee (daily brief path):** the workflow never merges,
  pushes, closes, approves, or requests changes — for either instance and
  regardless of which gather path ran. See
  [Review-First Safety](#review-first-safety) below.
- **Relationship to spec 005 / ADR-0007 (unchanged by this slice):** whichever
  corp gather path runs, its notifications and PR/issue context feed the **same**
  spec-005 review-first pipeline (`scripts/list-review-requests.js` →
  `scripts/fetch-github-{com,corp}.js --context` → the `pr-review` skill →
  `scripts/write-review-artifact.js` → opt-in
  `scripts/stage-review-if-enabled.js`). ADR-0007's staging policy — local
  review artifacts under `output/github-reviews/` by default, opt-in native
  GitHub *pending* review per repo/run that is never submitted — is **not**
  changed by 007-03; the MCP-first migration only affects the gather/context
  path feeding that pipeline.
- **Coverage is always user-facing:** the daily note's Corporate GitHub section
  reports which gather path ran and which configured orgs were quiet, active
  outside the lookback window, or unreachable — see
  `skills/morning-github/SKILL.md`'s Coverage section format.

### Review-First Safety

**Principle:** The assistant prepares work; the user decides and submits.

**Mechanics:** The system may draft messages, comments, and PR reviews, but should not send Slack messages, permanently delete email, edit Confluence, merge PRs, push code, or change Jira status as part of unattended runs.

### Codex-Scheduled Daily Brief

**Principle:** Scheduling should use the current automation surface before the
repo grows its own service process.

**Mechanics:** A Codex cron automation runs the manual Daily Brief command in
the long-lived repository workspace. The automation reports the dated and
latest output paths on success, and reports command output or JSON-envelope
errors in the run result on failure. The manual `npm run brief` path remains the
debugging and portability fallback.

### Vertical Source Slices

**Principle:** Each source area should earn its place by producing real daily value.

**Mechanics:** A slice should fetch a small set of high-signal inputs, triage them against personal context, render concise Markdown, include an explicit action layer, and save or update a reproducible fixture where practical.

## Module boundaries

<!-- elicited: 2026-06-18 / status: filled -->

- **Jig workflow layer:** `docs/specs/`, `.codex/skills/jig-*`, `.codex/agents/`, and `.codex/hooks*` define how work is planned, reviewed, and reconciled.
- **Source fetchers:** `scripts/fetch-*.js` and source-specific MCP/plugin calls gather raw inputs. They should not own cross-source synthesis.
- **Brief writer:** `scripts/write-brief.js` composes available source sections
  into the dated Daily Brief Markdown note and reports per-source results in the
  standard JSON envelope.
- **Source libraries:** `scripts/lib/**` contains narrow helpers such as config loading, Graph auth, GitHub helpers, and AI Radar fetch/triage/render modules.
- **Skills / orchestration docs:** `skills/**` records legacy source-area workflows and may become reference material as Codex plugins replace pieces.
- **Config:** `config/*.example.json` documents personal configuration shape; real configs remain ignored.
- **Output and fixtures:** `output/**` is generated and ignored; `tests/fixtures/**` stores reproducible examples for review and regression checks.
- **Legacy specs:** `specs/*.md` are historical references. Active work should move into `docs/specs/NNN-<slug>/`.

Current coupling is intentionally light: scripts return structured JSON envelopes, renderers produce Markdown, and orchestration consumes those outputs. Shared abstractions should be introduced only after repeated concrete need.

## Data model

<!-- elicited: 2026-06-18 / status: filled -->

This project is near-stateless. It owns local configuration, small caches, generated Markdown/JSON outputs, and fixtures.

- **Config examples:** `config/*.example.json` and skill config examples define source lists, filters, vault paths, and triage rules.
- **Personal config:** real `config/*.json`, `.env`, and token files are ignored and local.
- **Script output envelope:** helper scripts write JSON envelopes shaped like `{ ok, tool, mode, timestamp, data, errors }`.
- **AI Radar state:** seen-item cache and HTML page watch state prevent duplicate daily signals.
- **Generated output:** `output/**` contains latest and dated Markdown/JSON results; ignored by git.
- **Daily Brief output:** the manual writer creates dated and latest Markdown
  notes under `daily_brief.output_dir`, `DAILY_BRIEF_OUTPUT_DIR`, an Obsidian
  vault daily-notes folder, or `output/daily` by default.
- **Fixtures:** `tests/fixtures/ai-radar.*` captures reproducible sample output from real runs.
- **Jig state:** `scaffold.json`, `docs/specs/README.md`, spec frontmatter, and review artifacts track workflow state.
- **Obsidian notes:** the intended user-facing daily notes and meeting notes live outside the repo in the user's vault.

## Contract surfaces

<!-- elicited: 2026-06-18 / status: filled -->

- **CLI output envelopes** (internal data shape; recommended artifact: JSON Schema under `docs/contracts/script-envelope.schema.json`, not yet committed): every helper script writes structured JSON to stdout and diagnostic text to stderr.
- **Config files** (config/env surface; recommended artifact: JSON Schema per config family under `docs/contracts/config/*.schema.json`, not yet committed): examples exist under `config/*.example.json`.
- **Markdown digest sections** (internal rendering contract; recommended artifact: fixture snapshots in `tests/fixtures/`, partially present for AI Radar): rendered sections should stay stable enough for Obsidian review.
- **Daily Brief notes** (user-facing composition contract; recommended artifact:
  fixture-backed smoke output, formal snapshots deferred): the brief shell writes
  a dated Markdown note with a top-level action section, nested source sections,
  and a compact source-results summary.
- **Jig workflow artifacts** (process contract; recommended artifact: jig specs and review evidence under `docs/specs/`): active work should follow the lifecycle in `docs/workflow.md`.

No HTTP API, event bus, RPC, GraphQL schema, or database schema is currently exposed.

## Open questions

Deferred items live in [refinement-todo.md](refinement-todo.md). Current architecture questions include Outlook/M365 access, Slack plugin reliance, and how much legacy Cowork material to migrate. (GitHub review staging policy is resolved by [ADR-0007](decisions/adr-0007-review-first-github-pr-automation.md).)
