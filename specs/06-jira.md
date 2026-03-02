# Spec 06 — JIRA (Self-Hosted Data Center)

## Overview

Fetch JIRA activity from a self-hosted Data Center instance. The script watches specific projects defined in `config/jira.json` and returns tickets that are relevant to the user: assigned tickets with recent updates, tickets the user commented on, and tickets where the user was @mentioned. Results are structured for summarization and rendered in the daily note.

Read-only. The script never creates, updates, or transitions tickets.

---

## Authentication

Basic Auth with a personal API token:

```js
const auth = Buffer.from(`${process.env.JIRA_USER}:${process.env.JIRA_API_TOKEN}`).toString('base64')

const response = await fetch(`${process.env.JIRA_BASE_URL}/rest/api/2/search`, {
  headers: {
    'Authorization': `Basic ${auth}`,
    'Content-Type': 'application/json'
  }
})
```

### Environment Variables

```
JIRA_BASE_URL=https://jira.yourcompany.com
JIRA_USER=your@email.com
JIRA_API_TOKEN=your_personal_access_token
JIRA_CONFIG_PATH=./config/jira.json
```

Personal access tokens for self-hosted Jira DC are created at:
`https://jira.yourcompany.com/secure/ViewProfile.jspa` → Personal Access Tokens

---

## Configuration

### Config File: config/jira.json

See `config/jira.example.json`:

```json
{
  "projects": ["ENG", "OPS", "INFRA"],
  "lookback_hours_override": null
}
```

**`projects`** — array of JIRA project keys to watch. Required, no default.

**`lookback_hours_override`** — optional number. If set, overrides the global `LOOKBACK_HOURS` env var for JIRA only. Useful if JIRA is noisy and you want a shorter window. `null` means use global.

---

## JQL Queries

The script builds JQL from the project keys list. Three separate queries are run in parallel:

### Query 1 — Assigned tickets with recent updates

```
project in (ENG, OPS, INFRA)
AND assignee = currentUser()
AND updated >= -24h
ORDER BY updated DESC
```

Returns tickets assigned to the user that have had any activity (status change, comment, attachment, etc.) in the lookback window.

### Query 2 — Tickets the user commented on recently

```
project in (ENG, OPS, INFRA)
AND issueFunction in commented("by currentUser() after -24h")
AND assignee != currentUser()
ORDER BY updated DESC
```

Filters out tickets already caught by Query 1 (where user is assignee) to avoid duplicates.

> Note: `issueFunction` requires the ScriptRunner plugin. If it returns a 400 error, fall back to:
> ```
> project in (ENG, OPS, INFRA)
> AND comment ~ currentUser()
> AND updated >= -24h
> AND assignee != currentUser()
> ```
> This is less precise (searches comment text for username) but works on vanilla JIRA DC. Log a warning when falling back.

### Query 3 — Tickets where user was @mentioned

```
project in (ENG, OPS, INFRA)
AND comment ~ "[~accountId:USER_ACCOUNT_ID]"
AND updated >= -24h
AND assignee != currentUser()
ORDER BY updated DESC
```

Requires fetching the user's `accountId` first (see below). Filters out assignee tickets again to avoid duplicates.

### Fetching the User's accountId

```js
const me = await jiraFetch('/rest/api/2/myself')
const accountId = me.accountId  // or me.name for older DC versions
```

Call this once at module startup and reuse for Query 3.

### Building JQL Dynamically

```js
function buildProjectClause(projects) {
  return `project in (${projects.join(', ')})`
}
```

Never interpolate user-provided strings directly into JQL — only project keys from the config file are interpolated, and those are validated against `[A-Z][A-Z0-9]+` before use.

---

## API Endpoints

```
GET /rest/api/2/myself                    — fetch user accountId
GET /rest/api/2/search?jql=...&fields=... — search issues
GET /rest/api/2/issue/{key}/comment       — fetch recent comments (optional enrichment)
```

### Fields to Request

To minimize response size, always specify `fields`:

```
fields=summary,status,priority,assignee,reporter,updated,comment,labels,issuetype,parent
```

`comment` returns up to 5 most recent comments by default — sufficient for summarization.

---

## Deduplication

After running all three queries, deduplicate by issue key before returning:

```js
const seen = new Set()
const deduped = allIssues.filter(issue => {
  if (seen.has(issue.key)) return false
  seen.add(issue.key)
  return true
})
```

Priority for deduplication: Query 1 items take precedence (assignee is most actionable), then Query 2, then Query 3.

---

## Pagination

Use `startAt` and `maxResults`. Default page size: 50. Stop after 3 pages (150 issues) per query — if someone has 150+ JIRA updates in 24h, the summary will note truncation.

```js
const results = await jiraFetch('/rest/api/2/search', {
  jql,
  startAt: 0,
  maxResults: 50,
  fields: FIELDS
})
// results.total tells you if there are more pages
```

---

## Data Shape Returned by fetchJira()

```js
{
  ok: true,
  data: {
    issues: [
      {
        key: "ENG-482",
        summary: "Add OAuth2 support to auth service",
        type: "Story",
        status: "In Progress",
        priority: "High",
        assignedToMe: true,
        reason: "assigned",        // "assigned" | "commented" | "mentioned"
        labels: ["backend", "auth"],
        updatedAt: "2026-03-01T18:43:00Z",
        recentComments: [
          {
            author: "alice",
            body: "First 300 chars of comment...",
            createdAt: "2026-03-01T18:40:00Z"
          }
        ],
        url: "https://jira.yourcompany.com/browse/ENG-482"
      }
    ],
    truncated: false   // true if >150 results were hit
  }
}
```

`recentComments` includes up to 3 most recent comments, each truncated to 300 characters.

---

## Daily Note Rendering

```markdown
## 🎫 JIRA

### Needs Your Attention
- 🔴 **ENG-482** In Progress — Add OAuth2 support to auth service  
  Alice: "Blocked on the token refresh edge case — can you take a look?"  
  *(High · backend, auth · updated 2h ago)*

### You Commented / Were Mentioned  
- ℹ️ **OPS-91** Review — Database migration runbook  
  You were mentioned: "LGTM from @you, waiting on @bob"  
  *(Medium · updated 5h ago)*
```

Anchor comments:
```
<!-- AGENT:jira -->
```

Items identified by issue key (e.g. `ENG-482`) for smart merge deduplication.

---

## Error Handling

| Scenario | Behaviour |
|---|---|
| `config/jira.json` missing or `projects` empty | Return `{ ok: false, error: 'JIRA config missing or no projects configured — create config/jira.json' }` |
| Invalid project key format in config | Log warning, skip that key, continue with valid ones |
| ScriptRunner not available (Query 2 fallback) | Log `[jira] ScriptRunner unavailable, using fallback JQL for comments`, continue |
| Auth failure (401) | Return `{ ok: false, error: 'JIRA auth failed — check JIRA_USER and JIRA_API_TOKEN' }` |
| Instance unreachable | Return `{ ok: false, error: 'JIRA unreachable — check JIRA_BASE_URL and VPN' }` |
| Query returns 0 results | Return `{ ok: true, data: { issues: [], truncated: false } }` — not an error |
| Truncation at 150 issues | Include `truncated: true` in response, note in daily note: "_Results truncated — too many updates. Check JIRA directly._" |

---

## Standalone Runner

```js
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const result = await fetchJira(since)
  console.log(JSON.stringify(result, null, 2))

  if (isSaveFixture) {
    await fs.writeFile('tests/fixtures/jira.json', JSON.stringify(result, null, 2))
    console.log('[jira] Fixture saved')
  }
}
```

---

## Notes for Implementation

- No external JIRA client library — use native `fetch` with the helper pattern established in `msalClient.js`. A small `jiraFetch(path, params)` helper that handles auth headers and base URL is sufficient.
- The three JQL queries run in parallel via `Promise.allSettled` — a failure in one query does not prevent the others from completing.
- Comment bodies should have JIRA wiki markup stripped before truncating (e.g. `{code}`, `{noformat}`, `[~username]` → `@username`).
- `lookback_hours_override` applies to the JQL `-Nh` time expression, not just the `since` parameter passed in. Compute the effective lookback at module startup: `const hours = config.lookback_hours_override ?? parseInt(process.env.LOOKBACK_HOURS ?? '24')`
