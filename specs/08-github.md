# Spec 08 — GitHub (github.com + Corporate)

## Overview

Fetch GitHub notifications from two separate instances — github.com and a self-hosted corporate GitHub Enterprise instance. Each instance has its own token and independent notification filter configuration. Notifications are fetched, enriched with subject details, and returned as structured data for summarization.

Read-only. The script never creates issues, posts comments, or modifies anything.

---

## Library

`@octokit/rest` — one instance per GitHub host.

```js
import { Octokit } from '@octokit/rest'

const octokitCom = new Octokit({ auth: process.env.GITHUB_COM_TOKEN })

const octokitCorp = new Octokit({
  auth: process.env.GITHUB_CORP_TOKEN,
  baseUrl: process.env.GITHUB_CORP_BASE_URL  // e.g. https://github.yourcompany.com/api/v3
})
```

---

## Configuration

### Environment Variables

```
GITHUB_COM_TOKEN=ghp_...
GITHUB_CORP_TOKEN=ghp_...
GITHUB_CORP_BASE_URL=https://github.yourcompany.com/api/v3
GITHUB_CONFIG_PATH=./config/github.json
```

### Config File: config/github.json

See `config/github.example.json`. Both instances are configured independently:

```json
{
  "github.com": {
    "notifications": {
      "prs_to_review": true,
      "pr_activity": true,
      "issues_assigned": true,
      "issues_opened": true,
      "mentions": true,
      "ci_failures": true
    },
    "orgs": []
  },
  "corporate": {
    "notifications": {
      "prs_to_review": true,
      "pr_activity": true,
      "issues_assigned": true,
      "issues_opened": true,
      "mentions": true,
      "ci_failures": true
    },
    "orgs": ["my-org"]
  }
}
```

**`orgs`** — optional array of org names to restrict results to. Empty array means all orgs/repos the user has access to.

**Notification filter flags** — each can be toggled independently per instance. This controls which notification `reason` values and subject types are included (see Filtering section below).

---

## Fetch Strategy

### Step 1 — Fetch Raw Notifications

```js
await octokit.activity.listNotificationsForAuthenticatedUser({
  all: false,           // unread only
  since: since.toISOString(),
  per_page: 100
})
```

This returns up to 100 unread notifications updated since `since`. Paginate if `Link` header indicates more pages (unlikely for 24h window but handle it).

### Step 2 — Filter by Config

Apply the notification filter flags from `config/github.json`:

| Config flag | GitHub `reason` values included |
|---|---|
| `prs_to_review` | `review_requested` |
| `pr_activity` | `author` + subject type `PullRequest` |
| `issues_assigned` | `assign` |
| `issues_opened` | `author` + subject type `Issue` |
| `mentions` | `mention`, `team_mention` |
| `ci_failures` | `ci_activity` (filter further in Step 4) |

If an `orgs` array is specified, filter to notifications where `repository.owner.login` is in the list.

### Step 3 — Enrich with Subject Details

For each notification, fetch the subject URL to get meaningful context:

```js
// notification.subject.url is the API URL for the PR/issue/etc.
const subject = await octokit.request('GET ' + notification.subject.url)
```

Extract:
- For PRs: title, state (open/closed/merged), draft status, review status, head branch, author
- For Issues: title, state, labels, assignees
- For Commits: message, author
- For Releases: tag name, release notes excerpt

**Rate limiting:** GitHub's REST API allows 5000 requests/hour for authenticated users. With 100 notifications max, enrichment adds at most 100 requests — well within limits. No throttling needed.

### Step 4 — CI/CD Failure Detection

For `ci_activity` notifications (or any PR notification), check if recent check runs have failures:

```js
// Only if ci_failures is enabled in config
await octokit.checks.listForRef({
  owner,
  repo,
  ref: pr.head.sha,
  per_page: 10
})
```

Filter to check runs where `conclusion` is `failure` or `cancelled`. Only include in results if failures exist — don't surface passing CI.

If the check runs API returns a 404 (repo has no CI), skip silently.

---

## Personal Access Token Scopes Required

**github.com:**
- `notifications` — read notifications
- `repo` — read private repo details, PR/issue content, check runs

**Corporate GitHub Enterprise:**
- Same scopes as above
- Created at: `https://github.yourcompany.com/settings/tokens`

---

## Data Shape Returned by fetchGithub()

```js
{
  ok: true,
  data: {
    instance: "github.com",  // or "corporate"
    notifications: [
      {
        id: "12345678",
        type: "PullRequest",
        reason: "review_requested",
        repo: "myorg/my-repo",
        title: "feat: add OAuth2 support",
        url: "https://github.com/myorg/my-repo/pull/482",
        author: "alice",
        state: "open",
        isDraft: false,
        updatedAt: "2026-03-01T18:43:00Z",
        ciStatus: null,           // null | "failing" | "passing"
        ciFailures: [],           // array of { name, conclusion } for failing checks
        labels: [],               // for issues
        body: "First 500 chars of PR/issue description..."
      }
    ]
  }
}
```

`body` is truncated to 500 characters — enough for summarization context without excessive tokens.

---

## Module Structure

```js
// src/sources/githubDotCom.js
export async function fetchGithubDotCom(since) { ... }

// src/sources/githubCorp.js
export async function fetchGithubCorp(since) { ... }
```

Both files share a common internal helper imported from a shared module:

```js
// src/sources/githubShared.js  (not exported to index.js directly)
export async function fetchGithubNotifications(octokit, instance, config, since) { ... }
```

`githubDotCom.js` and `githubCorp.js` each instantiate their Octokit with the right credentials and call `fetchGithubNotifications`. This avoids duplicating the fetch + filter + enrich logic.

---

## Daily Note Rendering

```markdown
## 💻 GitHub
### github.com
- 🔴 **feat: add OAuth2 support** — `myorg/my-repo` #482  
  Review requested. Draft: No. *(Alice, 2h ago)*
- ℹ️ **fix: null pointer in auth flow** — `myorg/my-repo` #478  
  Your PR has new comments. CI: ✅
- 🔴 **Bug: login fails on Safari** — `myorg/my-repo` #201  
  Assigned to you. Open.

### Corporate GitHub
- 🔴 **INFRA-482 migration script** — `myorg/infra` #91  
  CI failing: `build`, `test`. *(2 checks)*
- ℹ️ **You were mentioned** — `myorg/backend` #334  
  "@you what do you think about this approach?"
```

Anchor comments:
```
<!-- AGENT:github_com -->
<!-- AGENT:github_corp -->
```

Items identified by `{repo}#{number}` for smart merge deduplication.

---

## Error Handling

| Scenario | Behaviour |
|---|---|
| Token missing or invalid | Return `{ ok: false, error: 'GitHub token missing/invalid — check GITHUB_*_TOKEN' }` |
| `GITHUB_CORP_BASE_URL` missing | Return `{ ok: false, error: 'Corporate GitHub base URL not configured' }` |
| `config/github.json` missing | Log warning, use defaults (all notification types enabled, no org filter) |
| Subject enrichment fails for one notification | Log warning, include notification with title only, skip body/CI |
| Check runs API returns 404 | Skip CI check silently for that repo |
| Rate limit hit (403 + X-RateLimit-Remaining: 0) | Return `{ ok: false, error: 'GitHub rate limit exceeded' }` |
| Corporate GitHub unreachable (ECONNREFUSED) | Return `{ ok: false, error: 'Corporate GitHub unreachable — check VPN?' }` |

The VPN note is important — corporate GitHub is often only reachable on VPN. A clear error message saves debugging time.

---

## Standalone Runner

```js
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const result = await fetchGithubDotCom(since)  // or fetchGithubCorp
  console.log(JSON.stringify(result, null, 2))

  if (isSaveFixture) {
    await fs.writeFile('tests/fixtures/github-com.json', JSON.stringify(result, null, 2))
    console.log('[github-com] Fixture saved')
  }
}
```

---

## CLAUDE.md Updates Required

None — `@octokit/rest` is already in dependencies. Add to env vars:

```
GITHUB_COM_TOKEN=
GITHUB_CORP_TOKEN=
GITHUB_CORP_BASE_URL=https://github.yourcompany.com/api/v3
GITHUB_CONFIG_PATH=./config/github.json
```

Add to `.gitignore`:
```
config/github.json
config/jira.json
config/confluence.json
config/slack.json
```

---

## Notes for Implementation

- The `config/` folder should be created in Phase 1 scaffolding with all `.example.json` files committed and the actual `.json` files gitignored
- `githubShared.js` is an internal helper — it is not exported from `src/sources/` directly and not called from `index.js`
- Mark notifications as read is intentionally NOT done — the script is read-only
- The `body` field should strip markdown formatting before truncating to keep it readable in the daily note
