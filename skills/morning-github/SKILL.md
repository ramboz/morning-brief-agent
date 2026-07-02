---
name: morning-github
description: GitHub sub-agent — corporate GitHub is MCP-first (gather notifications, PR/issue activity, review requests, and failed CI/Prow jobs via corp GitHub MCP tools; falls back to scripts/fetch-github-corp.js, then browser). GitHub.com stays on its connector/API-script path. Feeds the spec-005 review-first pipeline (local review artifacts by default, opt-in native pending review that never submits). Supports Morning Brief and Deep Dive modes.
allowed-tools: bash, computer
---

# Morning GitHub

Scans both github.com and corporate GitHub Enterprise for notifications, PR
reviews, and activity.

Per [ADR-0004](../../docs/decisions/adr-0004-mcp-plugin-first-source-integration.md)
and [spec 007](../../docs/specs/007-mcp-source-migration/spec.md), the
**corporate GitHub** gather path is **MCP-first**: the corp GitHub MCP tools
available in the running session are the primary path for gather + PR/issue
context enrichment, `scripts/fetch-github-corp.js` is the fallback interface,
and browser navigation is the last resort — see the fallback-scope note in
Step 1 and `docs/architecture.md`'s "Corporate GitHub: MCP-First With Bounded
Fallbacks" for the full boundary (slice 007-03).

**The github.com path is unchanged by this slice.** It continues to use the
Cowork GitHub connector with `scripts/fetch-github-com.js` as its script
fallback (see the GitHub.com entry in Step 1). Slice 007-03 only migrated the
corporate instance to MCP-first; do not convert the github.com path to MCP here.

**Relationship to spec 005 (ADR-0007) — unchanged by this slice.** Whichever
gather path runs for corporate GitHub, its notifications and PR/issue context
feed the **same** spec-005 review-first pipeline described in Step 3
(`list-review-requests.js` → `fetch-github-{com,corp}.js --context` → the
`pr-review` skill → `write-review-artifact.js` → opt-in
`stage-review-if-enabled.js`). The MCP-first change is only about the
gather/context path; ADR-0007's staging policy — **local review artifacts by
default, opt-in native GitHub pending review, never auto-submit** — is not
changed by 007-03.

This skill runs in an interactive session because the corp GitHub MCP tools
require one — it is not wired into the headless `scripts/write-brief.js`
composer. See "Legacy Cowork skill layer" in
[docs/refinement-todo.md](../../docs/refinement-todo.md) for why these two stay
separate for now.

## Load config

Read: `{scripts_path}/../config/github.json` — `{scripts_path}` is the repo's
`scripts/` directory (provided via `config/main.json`), so this path resolves to
the **project-root `config/github.json`**, the same file the fallback loader
`scripts/lib/config.js` reads. It is not under `skills/`.

Extract: `github_com` (enabled, url, orgs), `github_corp` (enabled, url, orgs),
and the per-instance `pending_review_staging` opt-in block (see Step 3). The
corp gather never claims instance-wide coverage — only the configured
`github_corp.orgs` are ever scanned.

---

## Morning Brief Mode

### Step 1 — GATHER (fast)

Run both instances in parallel where possible. Each instance fails
independently — a corp outage never blocks github.com and vice versa.

**GitHub.com (unchanged — connector/script, NOT MCP):**
- **gather_method = "connector":** Use the Cowork GitHub connector for
  notifications + PR data.
- **gather_method = "script" (fallback):** Run
  `node {scripts_path}/fetch-github-com.js --brief`.

This path is out of scope for the MCP migration (slice 007-03) and stays as-is.

**Corporate GitHub (MCP-first):**

**Primary — corp GitHub MCP tools:** Use the corporate GitHub MCP tools
available in the running session (referenced here by capability/operation, since
exact tool identifiers are env-specific — the same convention as the Jira and
Confluence slices). Scoped to the configured `github_corp.orgs` and the lookback
window, gather:

1. **Notification list:** unread notifications on the corp instance — review
   requests, mentions, assignments, and activity on your authored PRs/issues.
2. **PR list + PR context:** for each relevant PR (review requested, your
   authored PR with new activity), pull PR context — title, number, author,
   description, draft/ready state, review status, conversation + inline review
   comments.
3. **Check-runs / Prow failures:** for those PRs (and any CI-failure
   notifications), read the check-runs / Prow job status so failed jobs can be
   named and linked (AC2).
4. **Issue read:** for issues where you were mentioned or assigned and a reply
   looks expected, read the issue body, comments, labels, and assignees.

**If the corp MCP tools are unavailable:** fall back to
`node {scripts_path}/fetch-github-corp.js --brief` (parse the JSON envelope),
then to browser navigation (the corporate GitHub web UI via Claude in Chrome —
check for login/VPN, scan the notifications inbox, review-request queue, and
your open PRs) as a last resort. **Note which path was used in the output —
never silently substitute one for another.** All three paths are read-only for
the daily brief (see AC3 / Safety constraint).

**Fallback scope matches the primary path (slice 007-03) — note in Coverage
when the script fallback is used:** `fetch-github-corp.js --brief` runs the
same notification + PR/issue + failed-check scan over the same
`github_corp.orgs` scope and emits the standard envelope
`{ok, tool, mode, timestamp, data, errors}`. If it returns `ok: false`, report
the `errors` and mark Corporate GitHub **unavailable** for this run (see Error
handling) — do not fail silently. The fallback is a documented subset of the
primary path, not a second, competing implementation. The spec-005 review-first
pipeline (Step 3) does not depend on the corp MCP tools — it can enrich context
via `fetch-github-corp.js --context` after a script-fallback gather; note in
Coverage which gather path ran.

If `github_corp.orgs` is configured, filter notifications to those orgs only.
Do not expand scope beyond the configured orgs to compensate for a quiet or
unreachable org.

### Step 2 — ANALYZE (fast)

For each instance, classify notifications:
- **Review requested** (high priority) — someone requested a PR review.
- **PR activity on your PRs** — new comments, CI status changes.
- **Issue mentions and assignments.**
- **CI / Prow failures** — a check run or Prow job failed on a PR you care
  about.

For review-requested PRs, enrich with:
- PR title, number, author, description (~300 chars).
- Current review status, draft/ready state.
- CI status (passing/failing).
- Most recent 2-3 review comments.

**Failed jobs must be actionable (AC2):** every failed CI / Prow item carries
enough name + link context to decide whether to investigate — the failing
check/job name(s) and a link to the run (or the PR's checks tab). Do not report
"CI failing" without naming which job failed and linking it.

**Identify draft targets:** PRs where a review is requested and (for pending
review staging) `pending_review_staging.enabled: true` for that instance. Also:
issues where the user is mentioned or assigned and a response looks expected.

**Coverage note (required, per AC1):** name which corp gather path ran (MCP /
script / browser) and which configured orgs were quiet, active outside the
lookback window, or unreachable this run. A short line is enough. Never imply
full instance coverage.

### Step 3 — REVIEW (review-first, local artifact by default — spec 005 / ADR-0007, UNCHANGED)

This is the spec-005 PR-review pipeline. It is **unchanged** by the 007-03
MCP-first gather migration — the MCP-first gather in Step 1 just feeds context
into this same pipeline. Do not duplicate or rewrite it.

**PR reviews → local review artifact** (the default, per ADR-0007).

The review-first path writes a Markdown artifact to the repo-local
`output/github-reviews/` directory. It makes NO GitHub API writes — nothing is
staged on GitHub in this path. The user reads (and edits) the artifact before
any GitHub staging. Native pending-review staging is a separate, opt-in path
described further below (slice 005-03) and is off by default.

1. **Know WHICH PRs to review:** Run the isolated review-request queue:
   ```bash
   node {scripts_path}/list-review-requests.js --brief
   ```
   The `data.reviewRequests` array lists each PR you were asked to review as
   `{ instance, repo, number, title, author, url, reason }`. Iterate over these.
   (Surfaces fail independently — a missing token or VPN outage on one surface
   is reported in `errors` and does not block the other.)

2. **Fetch PR context for each request:** From the `repo` (`owner/name`) and
   `number`, run the matching instance script:
   ```bash
   node {scripts_path}/fetch-github-com.js  --context <owner> <repo> pr <number>
   node {scripts_path}/fetch-github-corp.js --context <owner> <repo> pr <number>
   ```
   The `data` object carries the full diff, description, conversation +
   inline review comments, CI/failed checks, and linked GitHub issues / JIRA
   keys. If the context fetch returns `ok: false`, record the skip and move on.
   (When the corp MCP tools are available, the equivalent PR context/diff/checks
   can come from the MCP path in Step 1; the `--context` script call is the
   fallback interface for enrichment and is what the pipeline invokes directly.)

3. **Run the `pr-review` skill** on that context (multi-perspective:
   Architecture, SRE, Security, QA, Product). The skill produces the review
   body: findings-lead, severity-tagged (Blockers / Should Fix / Nice to Have)
   with file:line references, plus a verdict. If a linked JIRA ticket or GitHub
   issue was found, check the implementation against the stated requirements.
   *(This step is an orchestrator/agent action — a Node script cannot run the
   skill.)*

4. **Write the review artifact:** Pipe the review body plus the PR identity and
   context into the artifact writer:
   ```bash
   echo '{"pr":{"instance":"github.com","owner":"octo-org","repo":"web-frontend","number":482,"title":"...","author":"...","url":"..."},"context":<--context data>,"reviewBody":"<pr-review output>"}' \
     | node {scripts_path}/write-review-artifact.js
   ```
   The writer renders the artifact (findings lead, header with
   repo/#/title/author/URL/instance/timestamp, and a `## Review context`
   summary) and writes it to
   `output/github-reviews/YYYY-MM-DD-{instance}-{owner}-{repo}-{number}.md`.
   Its envelope returns `data.path` and `data.missing` (any context pieces that
   could not be fetched — the artifact notes these explicitly). Surface the
   artifact path (and a link to the PR) in the daily note's Staged Drafts /
   Reviews output so the user can open a complete draft review without opening
   the implementation conversation.

5. **Optionally stage a pending review (opt-in only):** After the local
   artifact is written, run the gated stager. It reads config and decides
   whether this repo/instance opted in. By default (OFF) it makes NO API call
   and just echoes the local artifact — the artifact is the deliverable.
   ```bash
   echo '{"pr":{"instance":"github.com","owner":"octo-org","repo":"web-frontend","number":482,"url":"..."},"reviewBody":"<pr-review output>","artifactPath":"<data.path from step 4>"}' \
     | node {scripts_path}/stage-review-if-enabled.js
   ```
   - **Not opted in (default):** envelope carries `data.staged:false` with a
     `reason` and the `artifactPath`. Stop at the local artifact.
   - **Opted in + success:** envelope carries `data.staged:true`, `reviewId`,
     `prUrl`, AND still the `artifactPath`. The review is a GitHub *pending*
     review — invisible to others until the user clicks "Submit review". It is
     NEVER submitted, approved, changes-requested, merged, or pushed by the
     agent; the human submits in GitHub.
   - **Opted in + failure (auth/VPN/API):** the stager does NOT crash — its
     envelope is `ok:false` and PRESERVES the `artifactPath` with a clear error.
     The local artifact is the fallback; nothing is lost.

   Add `--dry-run` to resolve the decision and report what WOULD be staged
   (owner/repo/number, body length) without any API call — the safe way to
   verify opt-in wiring:
   ```bash
   echo '{"pr":{...},"reviewBody":"...","artifactPath":"..."}' \
     | node {scripts_path}/stage-review-if-enabled.js --dry-run
   ```

   Opt-in is configured per instance in `config/github.json` under
   `github_com` / `github_corp`:
   ```json
   "pending_review_staging": { "enabled": false, "repos": [] }
   ```
   `enabled:false` (default) = local artifacts only. `enabled:true` with a
   non-empty `repos` allowlist (names or `owner/repo`) stages only those repos;
   an empty `repos` with `enabled:true` stages for all detected review-request
   repos on that instance.

   **To discard a staged pending review:** `node {scripts_path}/discard-github-review.js --pr owner/repo#number [--instance corp]`
   Or discard all staged reviews: `node {scripts_path}/discard-github-review.js --all`
   IMPORTANT: The `gh` CLI cannot see or delete these reviews — it uses different auth. Always use the discard script.

   *(The lower-level `stage-github-review.js` still exists and posts the same
   body-only pending review; `stage-review-if-enabled.js` wraps it with the
   opt-in gate and safe fallback. Prefer the gated stager in the brief flow.)*

**Issue comment replies → local MD fragment** (no draft persistence on navigation):

1. **Fetch issue context:** Run `--context <owner> <repo> issue <number>` to get the issue body, all comments, labels, and assignees.

2. **Generate reply draft:** Based on the issue context, generate a response.

3. **Write to vault:** Pipe to `stage-local-draft.js`:
   ```bash
   echo '{"tool":"github","target":"org/repo#123","url":"https://...","title":"...","context":"...","draft":"..."}' | node {scripts_path}/stage-local-draft.js --vault {vault_path}
   ```

### Output

Return to orchestrator:
- Daily note section (formatted markdown)
- Draft targets list per instance

### Daily note section format

```markdown
### github.com
- 🔴 **feat: add OAuth2 support** — `myorg/my-repo` [#482](https://github.com/myorg/my-repo/pull/482)
  Review requested by Alice. CI: ✅ → [Pending review staged]
  *(2h ago)*
- ℹ️ **fix: null pointer in auth flow** — `myorg/my-repo` [#478](...)
  Your PR has 2 new comments from Alice.

### Corporate GitHub
- 🔴 **INFRA-482 migration script** — `myorg/infra` [#91](...)
  Review requested. CI failing: [`build`](https://git.corp.adobe.com/myorg/infra/pull/91/checks), [`e2e-test`](...) → [Review artifact staged]

### Reviews & Staged Drafts (3)
- [ ] myorg/my-repo #482 → Review artifact: `output/github-reviews/2026-03-19-github.com-myorg-my-repo-482.md` · [Pending review staged](https://github.com/myorg/my-repo/pull/482) · [Open PR](https://github.com/myorg/my-repo/pull/482)
- [ ] myorg/infra #91 → Review artifact: `output/github-reviews/2026-03-19-corporate-myorg-infra-91.md` *(missing: diff)* · [Open PR](https://git.corp.adobe.com/...)
- [ ] [[2026-03-19-github-myorg-infra-91-comment]] → [Open issue](https://git.corp.adobe.com/...)

### Coverage
_Corporate GitHub gathered via corp GitHub MCP tools. github.com via connector. No orgs unreachable._
```

Failed CI / Prow items name each failing job and link it (AC2) — never a bare
"CI failing". Review artifacts are local Markdown files (default path,
ADR-0007). When the writer's `data.missing` is non-empty, surface it inline so
the user knows the review is partial.

Each review row MUST link to the deliverable the user should open:
- **Default / not opted in / staging failed:** link the local review artifact
  path (`data.artifactPath`). This is the fallback and remains the editable
  source of truth even when a pending review was also staged.
- **Opted in + staged:** ALSO add a "Pending review staged" link to the PR
  (`data.prUrl` from `stage-review-if-enabled.js`) so the user can open it and
  click "Submit review". Never imply the review was submitted.

If a corp gather path was unavailable this run, the section degrades to a clear
note instead of omitting itself:

```markdown
### Corporate GitHub
_Corporate GitHub: unavailable — <reason> (corp GitHub MCP tools not connected this run; script fallback returned ok:false)._
```

---

## Deep Dive Mode

Answer the user's question about GitHub. No draft staging unless asked.

**Corporate GitHub (MCP-first):** use the corp GitHub MCP search/list
capability with the user's keywords (and any repo/date modifiers), scoped to
`github_corp.orgs` unless the user explicitly asks to search wider; use PR/issue
context/read for a hit.
**Fallback — script:** run `node {scripts_path}/fetch-github-corp.js --search "query"`.
**Fallback — browser:** navigate to the corporate GitHub search UI.

**GitHub.com (unchanged):**
- **gather_method = "connector":** Use the connector to search PRs/issues.
- **gather_method = "script":** Run `node {scripts_path}/fetch-github-com.js --search "query"`.
- **gather_method = "browser":** Navigate to the GitHub search UI.

Cross-reference JIRA ticket keys in branch names/PR titles if the query mentions a ticket.

Return a direct, conversational answer with PR numbers, links, and context.

---

## Error handling

| Scenario | Action |
|---|---|
| Corp GitHub MCP tools unavailable | Fall back to script, then browser; report which path was used |
| Script returns `ok: false` | Report the envelope `errors`, mark that instance **unavailable** for the run — do not fail silently |
| Login screen (browser) | Skip instance, report "GitHub requires login" |
| Corporate GitHub won't load / off VPN | Skip, report "Corporate GitHub unreachable — check VPN?" |
| An org can't be scanned (auth/scope) | Skip it, log it in the Coverage line, continue |
| 0 unread notifications | Report "Nothing to report." — not an error |
| PR page fails to load | Include notification title only, skip enrichment |
| Context fetch fails for drafting | Skip draft for that item, continue with next |
| Diff/comments unfetchable for a review | Still write the artifact; the writer records the gaps in `data.missing` and the artifact notes them. Surface the missing list in the daily note |
| Pending review creation fails (opt-in path) | Log error, fall back to the local review artifact |

## Safety constraints (inline, non-negotiable — AC3 read-first)

- **The daily-brief path is read-first.** No merge, push, close, approve, or
  request-changes action happens in the daily brief path — for either instance,
  and regardless of which gather path (MCP / script / browser) ran.
- **Never merge PRs or push code.**
- **Never close issues, approve reviews, or request changes.**
- Stage draft review comments only via the native pending review API (no event
  = pending), and only when opted in per repo/instance. The pending review is
  invisible to others and is **never submitted** by the agent — the user reads
  the diff and clicks "Submit review".
- **Never add a comment directly into GitHub** via MCP or browser submit — issue
  reply staging is local-MD fragments only, via `stage-local-draft.js`.
- **Never send, submit, or post** anything. Everything the agent produces is a
  draft/artifact staged for human review.
