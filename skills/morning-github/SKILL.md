---
name: morning-github
description: GitHub sub-agent — three-step workflow (gather via connector/API script, analyze notifications/PRs, stage draft review comments via Claude in Chrome). Supports both GitHub.com and Corporate GitHub. Supports Morning Brief and Deep Dive modes.
allowed-tools: bash, computer
---

# Morning GitHub

Scans both github.com and corporate GitHub Enterprise for notifications, PR reviews, and activity.

## Load config

Read: `~/.claude/skills/morning-github/config/github-repos.json`

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

### Step 3 — DRAFT (slow, targeted — if draft_enabled)

For each PR review draft target, use Claude in Chrome:

1. Navigate to the PR on GitHub
2. Go to the Files Changed tab
3. Find the overall review comment box at the bottom
4. Click into the review text area
5. Type a draft review comment
6. **Do NOT select Approve or Request Changes** — leave as "Comment" only
7. **STOP — do NOT click "Submit review"**

**Draft review guidance:**
- Acknowledge the PR ("Thanks for the PR — taking a look")
- Note what you'll focus on based on the PR title/description
- If CI is failing: "CI is failing — will need that resolved before merge"
- If it's a draft PR: note you'll review when marked ready
- 2-3 sentences — you haven't read the full diff yet

### Output

Return to orchestrator:
- Daily note section (formatted markdown)
- Draft targets list per instance

### Daily note section format

```markdown
### github.com
- 🔴 **feat: add OAuth2 support** — `myorg/my-repo` [#482](https://github.com/myorg/my-repo/pull/482)
  Review requested by Alice. CI: ✅ → [Draft staged]
  *(2h ago)*
- ℹ️ **fix: null pointer in auth flow** — `myorg/my-repo` [#478](...)
  Your PR has 2 new comments from Alice.

### Corporate GitHub
- 🔴 **INFRA-482 migration script** — `myorg/infra` [#91](...)
  Review requested. CI failing: `build`, `test`. → [Draft staged]

### Staged Drafts (2)
1. myorg/my-repo #482 → Review comment: will take a look, CI green
2. myorg/infra #91 → Review comment: noting CI failures
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
| Review textarea not found | Skip draft, log, continue |

## Safety constraint

**Never merge PRs, push code, close issues, approve reviews, or request changes.** Stage draft review comments only (as "Comment", never "Approve" or "Request changes"). The user reads the diff and submits.
