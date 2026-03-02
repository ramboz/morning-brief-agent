# Spec 03 — Outlook Email

## Overview

Fetch unread emails from the last 24h (Focused + Other inbox), classify them using Claude, save drafts for emails needing a reply, and triage obvious noise (newsletters, marketing, automated alerts) via archive. All write operations respect `isDryRun`.

---

## Library

Microsoft Graph API via built-in `fetch` (Node.js 20+). No SDK wrapper needed for mail endpoints.

Base URL: `https://graph.microsoft.com/v1.0`

---

## Folders to Check

Outlook's Focused Inbox exposes two well-known folder names accessible via Graph API:

- `focusedInbox` — corresponds to the Focused tab
- `inbox` — corresponds to the Other tab (non-focused inbox)

Fetch from both. Deduplicate by message `id` before processing (unlikely but possible).

**Well-known folder IDs to use:**
```
GET /me/mailFolders/inbox/messages
GET /me/mailFolders/inbox/messages?$filter=inferenceClassification eq 'focused'
GET /me/mailFolders/inbox/messages?$filter=inferenceClassification eq 'other'
```

Actually use a single query against the inbox with both inference classifications, or two separate calls — whichever the Graph API supports cleanly. Verify at implementation time.

---

## Fetch Parameters

```
GET /me/mailFolders/inbox/messages
  ?$filter=isRead eq false and receivedDateTime ge {since.toISOString()}
  &$select=id,subject,from,receivedDateTime,bodyPreview,body,inferenceClassification,conversationId,importance
  &$top=50
  &$orderby=receivedDateTime desc
```

- Max 50 emails per run — if more than 50 unread arrive in 24h, the oldest are dropped (acceptable edge case)
- Fetch `body` (full HTML) in addition to `bodyPreview` — the summarization prompt needs enough context for good classification
- Strip HTML tags from `body.content` before passing to Claude — plain text only

---

## Data Shape Returned by fetchOutlook()

```js
{
  ok: true,
  data: {
    emails: [
      {
        id: "AAMkAGI...",
        subject: "Re: Q1 planning",
        from: { name: "Jane Smith", email: "jane@company.com" },
        receivedAt: "2026-03-01T18:43:00Z",
        bodyPreview: "Hi, following up on...",
        bodyText: "Hi, following up on the Q1 planning doc...", // HTML stripped
        conversationId: "AAQkAGI...",
        importance: "normal", // normal | high | low
        inferenceClassification: "focused" // focused | other
      }
    ]
  }
}
```

---

## Triage Classification

Classification is performed by `summarizeEmails()` in `src/ai/summarize.js`. The source module returns raw data only — no classification logic in `outlook.js`.

### Classification Categories

| Category | Description | Auto-action |
|---|---|---|
| `action_required` | Needs a human response or decision | Keep in inbox |
| `fyi` | Informational, no reply needed | Keep in inbox |
| `newsletter` | Subscription content, digests, updates | Archive |
| `marketing` | Promotional emails, offers, product updates | Archive |
| `automated_alert` | CI/CD, monitoring, system notifications | Archive |
| `junk` | Spam or unsolicited | Move to Deleted Items |

### Conservative Default

If Claude's confidence is not high (i.e. the classification is ambiguous), default to `fyi` — never auto-archive or delete uncertain emails.

For the first 5 runs (dry-run mode), no emails are actually moved. After that, `newsletter`, `marketing`, and `automated_alert` are archived. `junk` is moved to Deleted Items.

---

## Draft Reply Generation

A draft reply is generated only when **all** of the following are true:

1. Email is classified as `action_required`
2. Claude judges that a reply is clearly expected (not just an FYI that was miscategorised)
3. The email is a reply in an existing thread (has a `conversationId` with prior messages) **or** a direct request addressed to the user

Claude should **not** generate a draft for:
- Emails that just need the user to take an action (e.g. "please review this PR") — flag as action_required but no draft
- Group emails where the user is CC'd, not TO'd — unless directly addressed
- Meeting invitations — these are handled separately

### Draft Shape

```js
{
  toEmail: "jane@company.com",
  toName: "Jane Smith",
  subject: "Re: Q1 planning",
  body: "Hi Jane,\n\nThanks for following up...\n\nBest,\n[User]",
  inReplyTo: "AAMkAGI...", // original message id
  conversationId: "AAQkAGI..."
}
```

### Tone & Language

- **Language:** English only
- **Tone:** Friendly but professional
- **Signature:** End with `Best,\n[Your name]` — Claude should use a placeholder `[Your name]` since it doesn't know the user's name
- **Length:** Keep drafts concise — 3-5 sentences unless the email clearly requires more
- **Never fabricate facts** — if Claude doesn't have enough context to write a substantive reply, write a holding reply: "Thanks for your email — I'll get back to you on this shortly."

---

## saveEmailDraft()

```js
/**
 * Saves a draft reply to the user's Outlook Drafts folder.
 * @param {string} accessToken
 * @param {object} draft - see draft shape above
 * @returns {Promise<{ ok: boolean, draftId?: string, error?: string }>}
 */
export async function saveEmailDraft(accessToken, draft)
```

**Graph API call:**
```
POST /me/messages
{
  "subject": "Re: Q1 planning",
  "isDraft": true,
  "body": { "contentType": "Text", "content": "..." },
  "toRecipients": [{ "emailAddress": { "address": "jane@company.com", "name": "Jane Smith" } }],
  "conversationId": "AAQkAGI...",
  "inReplyTo": "AAMkAGI..."  // if available
}
```

In dry-run mode: log the draft content to console, skip the API call, return `{ ok: true, draftId: 'dry-run' }`.

---

## triageEmail()

```js
/**
 * Archives or deletes an email.
 * @param {string} accessToken
 * @param {string} emailId
 * @param {'archive' | 'delete'} action
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function triageEmail(accessToken, emailId, action)
```

**Archive:**
```
POST /me/messages/{id}/move
{ "destinationId": "archive" }
```

**Delete (move to Deleted Items):**
```
POST /me/messages/{id}/move
{ "destinationId": "deleteditems" }
```

In dry-run mode: log the action (`[outlook] would archive: {subject}`) and return `{ ok: true }` without calling the API.

---

## Output Shape for Summarization

`summarizeEmails()` in `src/ai/summarize.js` receives the raw email array and returns:

```js
{
  actionRequired: [
    {
      subject: "Re: Q1 planning",
      from: "Jane Smith",
      summary: "Jane is asking for your input on the Q1 roadmap before Friday's meeting.",
      hasDraft: true
    }
  ],
  fyi: [
    {
      subject: "Weekly engineering digest",
      from: "Engineering Bot",
      summary: "Summary of merged PRs and deployment activity this week."
    }
  ],
  autoArchived: [
    { subject: "Your LinkedIn weekly digest", action: "archive" },
    { subject: "Build #4821 passed", action: "archive" }
  ],
  drafts: [
    {
      toEmail: "jane@company.com",
      subject: "Re: Q1 planning",
      body: "Hi Jane,\n\n..."
    }
  ]
}
```

---

## Daily Note Rendering

### Action Required

```markdown
### Action Required
- **Re: Q1 planning** — Jane Smith  
  Jane is asking for your input on the Q1 roadmap before Friday's meeting. ✉️ *Draft saved to Outlook*
```

### FYI

```markdown
### FYI / Reading
- **Weekly engineering digest** — Engineering Bot  
  Summary of merged PRs and deployment activity this week.
```

### Auto-Archived

```markdown
### Auto-Archived
- Your LinkedIn weekly digest *(archived)*
- Build #4821 passed *(archived)*
```

In dry-run mode, change `*(archived)*` to `*(would archive — dry run)*`.

---

## Error Handling

| Scenario | Behaviour |
|---|---|
| Graph API returns 401 | Throw — let index.js trigger re-auth |
| Graph API returns 429 (rate limit) | Wait `Retry-After` header seconds, retry once |
| Graph API returns 5xx | Return `{ ok: false, error: '...' }` — briefing continues without email section |
| Email body fetch fails for one email | Skip that email, log warning, continue |
| Draft save fails | Log error, include email in briefing with note "draft could not be saved" |
| Triage action fails for one email | Log error, continue with remaining emails |

---

## Standalone Runner

```js
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { acquireToken } = await import('../auth/msalClient.js')
  const token = await acquireToken()
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const result = await fetchOutlook(token, since)
  console.log(JSON.stringify(result, null, 2))
}
```
