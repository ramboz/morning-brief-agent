---
name: morning-github
description: GitHub sub-agent — three-step workflow (gather via connector/API script, analyze notifications/PRs, stage draft PR reviews via pending review API and issue comment drafts as local MD fragments). Supports both GitHub.com and Corporate GitHub. Supports Morning Brief and Deep Dive modes.
allowed-tools: bash, computer
---

# Morning GitHub

Scans both github.com and corporate GitHub Enterprise for notifications, PR reviews, and activity.

## Load config

Read: `{scripts_path}/../config/github.json`

Extract: `github_com` (enabled, url, orgs), `github_corp` (enabled, url, orgs).

---

## Morning Brief Mode

### Step 1 — GATHER (fast)

Run both instances in parallel where possible.

**GitHub.com:**
- **gather_method = "connector":** Use Cowork GitHub connector for notifications + PR data.
- **gather_method = "script" (fallback):** Run `node {scripts_path}/fetch-github-com.js --brief`

**Corporate GitHub:**
- **gather_method = "script":** Run `node {scripts_path}/fetch-github-corp.js --brief`

If a script returns `ok: false`, report errors and skip that instance.

If `orgs` is configured, filter notifications to those orgs only.

### Step 2 — ANALYZE (fast)

For each instance, classify notifications:
- **Review requested** (high priority) — someone requested a PR review
- **PR activity on your PRs** — new comments, CI status changes
- **Issue mentions and assignments**
- **CI failures**

For review-requested PRs, enrich with:
- PR title, number, author, description (~300 chars)
- Current review status, draft/ready state
- CI status (passing/failing)
- Most recent 2-3 review comments

**Identify draft targets:** PRs where a review is requested and `draft_enabled: true`.
Also: Issues where the user is mentioned or assigned and a response looks expected.

### Step 3 — REVIEW (review-first, local artifact by default)

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
  Review requested. CI failing: `build`, `test`. → [Pending review staged]

### Reviews & Staged Drafts (3)
- [ ] myorg/my-repo #482 → Review artifact: `output/github-reviews/2026-03-19-github.com-myorg-my-repo-482.md` · [Pending review staged](https://github.com/myorg/my-repo/pull/482) · [Open PR](https://github.com/myorg/my-repo/pull/482)
- [ ] myorg/infra #91 → Review artifact: `output/github-reviews/2026-03-19-corporate-myorg-infra-91.md` *(missing: diff)* · [Open PR](https://git.corp.adobe.com/...)
- [ ] [[2026-03-19-github-myorg-infra-91-comment]] → [Open issue](https://git.corp.adobe.com/...)
```

Review artifacts are local Markdown files (default path, ADR-0007). When the
writer's `data.missing` is non-empty, surface it inline so the user knows the
review is partial.

Each review row MUST link to the deliverable the user should open:
- **Default / not opted in / staging failed:** link the local review artifact
  path (`data.artifactPath`). This is the fallback and remains the editable
  source of truth even when a pending review was also staged.
- **Opted in + staged:** ALSO add a "Pending review staged" link to the PR
  (`data.prUrl` from `stage-review-if-enabled.js`) so the user can open it and
  click "Submit review". Never imply the review was submitted.

---

## Deep Dive Mode

Answer the user's question about GitHub. No draft staging unless asked.

**gather_method = "connector":** Use connector to search PRs/issues.
**gather_method = "script":** Run `node {scripts_path}/fetch-github-{com|corp}.js --search "query"`
**gather_method = "browser":** Navigate to GitHub search UI.

Cross-reference JIRA ticket keys in branch names/PR titles if the query mentions a ticket.

Return a direct, conversational answer with PR numbers, links, and context.

---

## Error handling

| Scenario | Action |
|---|---|
| Script returns `ok: false` | Report errors, skip that instance |
| Login screen (browser) | Skip instance, report "GitHub requires login" |
| Corporate GitHub won't load | Skip, report "Corporate GitHub unreachable — check VPN?" |
| 0 unread notifications | Report "Nothing to report." — not an error |
| PR page fails to load | Include notification title only, skip enrichment |
| Context fetch fails for drafting | Skip draft for that item, continue with next |
| Diff/comments unfetchable for a review | Still write the artifact; the writer records the gaps in `data.missing` and the artifact notes them. Surface the missing list in the daily note |
| Pending review creation fails (opt-in path) | Log error, fall back to the local review artifact |

## Safety constraint

**Never merge PRs, push code, close issues, approve reviews, or request changes.** Stage draft review comments only via pending review API (no event = pending). The user reads the diff and submits.
