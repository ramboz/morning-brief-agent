# Spec 07 — Confluence (Self-Hosted Data Center)

## Overview

Fetch recently modified Confluence pages from watched spaces defined in `config/confluence.json`. The script identifies pages that were created or updated in the lookback window, fetches a short excerpt, and flags pages where the current user was mentioned. Results are passed to Claude for engagement assessment — the goal is not a list of changes but an answer to "which pages need my attention today?"

Read-only. The script never creates or modifies pages.

---

## Authentication

Same Basic Auth pattern as JIRA — shared credential in `.env`:

```js
const auth = Buffer.from(`${process.env.CONFLUENCE_USER}:${process.env.CONFLUENCE_API_TOKEN}`).toString('base64')
```

For self-hosted DC, JIRA and Confluence API tokens may be the same personal access token if they share an identity provider, or separate. Use separate env vars to be safe.

### Environment Variables

```
CONFLUENCE_BASE_URL=https://confluence.yourcompany.com
CONFLUENCE_USER=your@email.com
CONFLUENCE_API_TOKEN=your_personal_access_token
CONFLUENCE_CONFIG_PATH=./config/confluence.json
```

---

## Configuration

### Config File: config/confluence.json

See `config/confluence.example.json`:

```json
{
  "spaces": ["ENG", "PRODUCT", "COMPANY"],
  "lookback_hours_override": null
}
```

**`spaces`** — array of Confluence space keys to watch. Required, no default.

**`lookback_hours_override`** — same semantics as the JIRA equivalent. `null` means use global `LOOKBACK_HOURS`.

Space keys are the short identifier shown in the URL: `https://confluence.yourcompany.com/display/ENG/...` → key is `ENG`.

---

## Fetch Strategy

Two queries run in parallel:

### Query 1 — Recently modified pages in watched spaces

Use the Confluence REST API content search:

```
GET /rest/api/content/search?cql=...&expand=version,space,body.excerpt&limit=50
```

CQL query:
```
space in (ENG, PRODUCT, COMPANY)
AND lastModified >= now("-24h")
AND type = page
ORDER BY lastModified DESC
```

Building the CQL dynamically:

```js
function buildSpaceClause(spaces) {
  return `space in (${spaces.map(s => `"${s}"`).join(', ')})`
}
```

### Query 2 — Pages where the user was mentioned in comments

```
space in (ENG, PRODUCT, COMPANY)
AND type = comment
AND text ~ "[~username]"
AND created >= now("-24h")
```

This searches comment bodies for the user's username mention. Returns comment objects — each has a `container` property pointing to the parent page.

Fetch the parent pages from the container references to get page titles and URLs.

**Fallback:** If the comment mention search returns unexpected results or the username format differs (some DC versions use account IDs in mentions), log a warning and skip Query 2 rather than failing.

---

## API Endpoints

```
GET /rest/api/content/search?cql=...    — CQL search (pages and comments)
GET /rest/api/content/{id}?expand=...   — fetch individual page details
GET /rest/api/user/current              — fetch current user info (username, accountId)
```

### Expand Parameters

For page results, request:
```
expand=version,space,body.excerpt,ancestors
```

- `version` — who last modified and when
- `body.excerpt` — first ~200 chars of page content (Confluence provides this automatically)
- `ancestors` — parent page breadcrumb (useful for context: "Engineering > Backend > Auth Service")

---

## Pagination

Default page size: 50. Use `start` offset for pagination. Stop after 2 pages (100 pages) per query — if a space has >100 page edits in 24h, truncate and note it.

```js
const response = await confluenceFetch('/rest/api/content/search', {
  cql,
  start: 0,
  limit: 50,
  expand: 'version,space,body.excerpt,ancestors'
})
// response.size < response.limit means last page
```

---

## Deduplication

After combining results from both queries, deduplicate by page ID. Pages from Query 2 (mention) take precedence so the `reason` field reflects the higher-priority signal.

```js
const pageMap = new Map()

// Add Query 1 results first
for (const page of recentPages) {
  pageMap.set(page.id, { ...page, reason: 'modified' })
}

// Query 2 mention pages overwrite with updated reason
for (const page of mentionPages) {
  pageMap.set(page.id, { ...pageMap.get(page.id) ?? page, reason: 'mentioned' })
}
```

---

## Data Shape Returned by fetchConfluence()

```js
{
  ok: true,
  data: {
    pages: [
      {
        id: "123456",
        title: "Auth Service Architecture",
        space: "ENG",
        spaceKey: "ENG",
        reason: "modified",          // "modified" | "mentioned"
        lastModifiedBy: "alice",
        lastModifiedAt: "2026-03-01T17:30:00Z",
        excerpt: "First ~200 chars of page content...",
        breadcrumb: "Engineering > Backend",
        url: "https://confluence.yourcompany.com/display/ENG/Auth+Service+Architecture",
        version: 14
      }
    ],
    truncated: false
  }
}
```

---

## Daily Note Rendering

```markdown
## 📖 Confluence

### Pages Needing Attention
- 📝 **Auth Service Architecture** — `ENG`
  Alice added a token refresh edge case section — may affect your area
  *(Engineering > Backend · v14 · 2h ago)*

- 📝 **Q1 Roadmap** — `PRODUCT`
  OAuth2 epic moved to Q2 — check if this affects your team's timeline
  *(Product > Planning · v7 · 5h ago)*

- 🔔 **Deployment Runbook** — `OPS` *(you were mentioned)*
  Comment: "Can @you review the rollback section before we publish?"
  *(Operations · v3 · 3h ago)*
```

Anchor comment:
```
<!-- AGENT:confluence -->
```

Items identified by page ID for smart merge deduplication.

---

## Error Handling

| Scenario | Behaviour |
|---|---|
| `config/confluence.json` missing or `spaces` empty | Return `{ ok: false, error: 'Confluence config missing or no spaces configured — create config/confluence.json' }` |
| Auth failure (401) | Return `{ ok: false, error: 'Confluence auth failed — check CONFLUENCE_USER and CONFLUENCE_API_TOKEN' }` |
| Instance unreachable | Return `{ ok: false, error: 'Confluence unreachable — check CONFLUENCE_BASE_URL and VPN' }` |
| Invalid space key (404 from CQL) | Log warning for that space, continue with valid spaces. Confluence CQL returns an error if any space in the `in` clause doesn't exist — run each space as a separate query if the combined query fails. |
| Comment mention search fails | Log `[confluence] Mention search unavailable, skipping`, return Query 1 results only |
| No results | Return `{ ok: true, data: { pages: [], truncated: false } }` |
| Truncation | Include `truncated: true`, note in daily note |

### Space Key Validation Note

Confluence CQL will error if a space key in the `in (...)` clause doesn't exist. To handle this gracefully without making a pre-flight API call per space, wrap the combined CQL query in a try/catch. If it fails with a CQL error, fall back to running one query per space and skip any that 404.

---

## Standalone Runner

```js
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const result = await fetchConfluence(since)
  console.log(JSON.stringify(result, null, 2))

  if (isSaveFixture) {
    await fs.writeFile('tests/fixtures/confluence.json', JSON.stringify(result, null, 2))
    console.log('[confluence] Fixture saved')
  }
}
```

---

## Notes for Implementation

- Same `confluenceFetch(path, params)` helper pattern as `jiraFetch` — handles auth headers and base URL. These can share an `atlassianFetch` helper in a shared util file if convenient, since auth is identical.
- `body.excerpt` from the Confluence API is already plain text (no wiki markup) — use it directly, truncate to 200 chars if longer.
- For comment mentions, the comment `body` may contain Confluence storage format XML. Strip tags before using: `body.replace(/<[^>]+>/g, ' ').trim().slice(0, 300)`.
- The `ancestors` expand gives a breadcrumb array — join the last 2 ancestors with ` > ` for a concise location string.
- Both JIRA and Confluence are self-hosted and likely on the same VPN. If both fail simultaneously with ECONNREFUSED, the user is probably off VPN — the error messages should both say "check VPN".
