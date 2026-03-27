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

### Step 3 — DRAFT (API-based — if draft_enabled)

**PR reviews → Pending review via GitHub API** (native draft mechanism, zero risk):

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

### Staged Drafts (2)
- [ ] myorg/my-repo #482 → Pending review staged · [Open PR](https://github.com/myorg/my-repo/pull/482)
- [ ] [[2026-03-19-github-myorg-infra-91-comment]] → [Open issue](https://git.corp.adobe.com/...)
```

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
| Pending review creation fails | Log error, fall back to local MD fragment |

## Safety constraint

**Never merge PRs, push code, close issues, approve reviews, or request changes.** Stage draft review comments only via pending review API (no event = pending). The user reads the diff and submits.
