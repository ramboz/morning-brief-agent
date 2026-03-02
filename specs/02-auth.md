# Spec 02 — MSAL Authentication

## Overview

The script uses MSAL (Microsoft Authentication Library) with the delegated OAuth2 flow. The user runs the script on their main work machine. On first run, a browser window opens for interactive login. On all subsequent runs, the token is refreshed silently using a saved refresh token.

---

## Library

`@azure/msal-node` — `PublicClientApplication` (no client secret, public client flow)

---

## Configuration

Read from `.env`:

```
AZURE_CLIENT_ID=        # Application (client) ID from Azure portal
AZURE_TENANT_ID=        # Directory (tenant) ID from Azure portal
MSAL_TOKEN_PATH=./token.json
```

---

## Scopes

```js
const SCOPES = [
  'Mail.Read',
  'Mail.ReadWrite',
  'Mail.Send',
  'Calendars.Read',
  'TeamsActivity.Read',
  'OnlineMeetings.Read',
  'Files.Read.All',
  'offline_access',
]
```

`offline_access` is required to receive a refresh token.

---

## Token Storage

Tokens are persisted to `MSAL_TOKEN_PATH` (default: `./token.json`) as JSON.

**Shape of token.json:**
```json
{
  "homeAccountId": "...",
  "refreshToken": "...",
  "accessToken": "...",
  "expiresOn": "2026-03-02T09:00:00.000Z",
  "scopes": ["Mail.Read", "..."]
}
```

`token.json` must be in `.gitignore`. Never commit it.

---

## Auth Flow

### First Run (no token.json exists)

1. Call `app.acquireTokenInteractive({ scopes })` — this opens the default browser to the Microsoft login page
2. User logs in with their work account
3. On success, save the full token response to `token.json`
4. Return `result.accessToken`

### Subsequent Runs (token.json exists)

1. Load `token.json`
2. Check if `expiresOn` is more than 5 minutes in the future
3. If still valid: return `accessToken` directly (no API call)
4. If expired or expiring soon: call `app.acquireTokenSilent({ scopes, account })` using the saved `homeAccountId`
5. On success: update `token.json` with new token data, return new `accessToken`
6. On silent failure (e.g. refresh token expired): fall back to interactive login (step 1 of first run)

### Silent Failure Fallback

If `acquireTokenSilent` throws, log a clear message:
```
[auth] Silent token refresh failed. Re-authenticating interactively...
```
Then delete `token.json` and run the interactive flow. This handles cases where the refresh token has expired (typically after 90 days of inactivity in most tenants).

---

## Exported API

```js
// src/auth/msalClient.js

/**
 * Acquires a valid Microsoft Graph access token.
 * Handles first-run interactive login and subsequent silent refresh.
 * @returns {Promise<string>} access token
 */
export async function acquireToken()
```

No other functions need to be exported.

---

## Error Handling

| Scenario | Behaviour |
|---|---|
| `token.json` missing | Trigger interactive login |
| `token.json` malformed/corrupt | Log warning, delete file, trigger interactive login |
| Silent refresh fails | Log warning, trigger interactive login |
| Interactive login fails or is cancelled | Throw with message: `[auth] Authentication failed. Cannot continue.` — let index.js catch this and exit |
| Network unavailable | MSAL will throw — propagate the error, let index.js handle graceful exit |

---

## Standalone Runner

```js
// Bottom of msalClient.js
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const token = await acquireToken()
  console.log('[auth] Token acquired successfully.')
  console.log('[auth] First 20 chars:', token.substring(0, 20) + '...')
}
```

Running `node src/auth/msalClient.js` should open the browser on first run and print a partial token on success.

---

## Notes

- The script runs on the same machine where the user works, so the browser popup for interactive login is not a UX problem
- MSAL handles PKCE automatically for public client flows — no extra configuration needed
- MFA prompts are handled by the browser during interactive login — the script itself does not need to handle MFA
- Refresh tokens for work accounts in most tenants last 90 days if used regularly; the silent refresh on each daily run will keep it alive indefinitely
