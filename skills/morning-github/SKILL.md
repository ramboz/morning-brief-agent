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

**Optional — native pending review via GitHub API** (opt-in only, slice 005-03).

Only when native pending-review staging is explicitly enabled for the repo/run
(never by default), the review body may additionally be staged as a GitHub
*pending* review — invisible to others until the user clicks "Submit review".
This is the path below; do NOT run it unless staging is enabled.

1. **Fetch PR context:** Run the script with `--context <owner> <repo> pr <number>` to get:
   - Full diff, PR description, conversation comments, inline review comments
   - Linked GitHub issues (parsed from "Fix #123" / "Closes #123" in PR body)
   - Linked JIRA ticket keys (parsed from "SITES-1234" patterns in PR body/title)

2. **Enrich with linked issues:** If `linkedJiraKeys` is non-empty and JIRA is available, fetch those tickets via `node {scripts_path}/fetch-jira.js --search "key = SITES-1234"` to add business context (ticket title, description, acceptance criteria).

3. **Generate review:** Using the pr-review skill's framework (multi-perspective: Architecture, SRE, Security, QA, Product), generate a full review of the PR. Include:
   - Summary (what the PR does, overall assessment)
   - Strengths (genuine positives)
   - Issues (Blockers / Should Fix / Nice to Have) with file:line references
   - Verdict (Ready to merge / With fixes / No)

   If a linked JIRA ticket or GitHub issue was found, check whether the implementation matches the stated requirements.

4. **Stage pending review:** Pipe the review body to `stage-github-review.js`:
   ```bash
   echo '{"owner":"org","repo":"name","number":123,"body":"...review...","instance":"com"}' | node {scripts_path}/stage-github-review.js
   ```
   For corporate GitHub, set `"instance":"corp"`.

   The review stays invisible to others until the user clicks "Submit review" in the GitHub UI. The user can edit the review before submitting.

   **To discard a staged review:** `node {scripts_path}/discard-github-review.js --pr owner/repo#number [--instance corp]`
   Or discard all staged reviews: `node {scripts_path}/discard-github-review.js --all`
   IMPORTANT: The `gh` CLI cannot see or delete these reviews — it uses different auth. Always use the discard script.

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
- [ ] myorg/my-repo #482 → Review artifact: `output/github-reviews/2026-03-19-github.com-myorg-my-repo-482.md` · [Open PR](https://github.com/myorg/my-repo/pull/482)
- [ ] myorg/infra #91 → Review artifact: `output/github-reviews/2026-03-19-corporate-myorg-infra-91.md` *(missing: diff)* · [Open PR](https://git.corp.adobe.com/...)
- [ ] [[2026-03-19-github-myorg-infra-91-comment]] → [Open issue](https://git.corp.adobe.com/...)
```

Review artifacts are local Markdown files (default path, ADR-0007). When the
writer's `data.missing` is non-empty, surface it inline so the user knows the
review is partial.

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
