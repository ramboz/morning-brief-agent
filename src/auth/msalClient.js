import 'dotenv/config'
import fs from 'fs/promises'
import { exec } from 'child_process'
import { promisify } from 'util'
import { PublicClientApplication } from '@azure/msal-node'
import { fileURLToPath } from 'url'

const execAsync = promisify(exec)

/**
 * Opens a URL in the system default browser, cross-platform.
 * Required by acquireTokenInteractive — MSAL Node does not open the browser itself.
 * @param {string} url
 */
async function openBrowser(url) {
  const cmd = process.platform === 'win32'
    ? `start "" "${url}"`
    : process.platform === 'darwin'
    ? `open "${url}"`
    : `xdg-open "${url}"`
  await execAsync(cmd)
}

const SCOPES = [
  'Mail.Read',
  'Mail.ReadWrite',
  'Mail.Send',
  'Calendars.Read',
  'OnlineMeetings.Read',
  'offline_access',
  // Deferred — require admin consent, only needed for Phase 7 (Teams):
  // 'TeamsActivity.Read'  — always requires admin consent
  // 'Files.Read.All'      — requires admin consent; revisit with IT when implementing Teams
]

const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000 // 5 minutes

function buildMsalApp() {
  const clientId = process.env.AZURE_CLIENT_ID
  const tenantId = process.env.AZURE_TENANT_ID
  if (!clientId) throw new Error('[auth] AZURE_CLIENT_ID is not set in environment')
  if (!tenantId) throw new Error('[auth] AZURE_TENANT_ID is not set in environment')

  return new PublicClientApplication({
    auth: {
      clientId,
      authority: `https://login.microsoftonline.com/${tenantId}`,
      // No redirectUri here — acquireTokenInteractive uses MSAL's internal loopback client
      // which picks a dynamic port (e.g. http://localhost:52341).
      // Register bare "http://localhost" in Azure portal to allow any port:
      // App Registration → Authentication → Mobile and desktop applications → http://localhost
    },
  })
}

/**
 * Reads and parses token.json. Returns null if missing or malformed.
 * @param {string} tokenPath
 * @returns {Promise<object|null>}
 */
async function loadTokenCache(tokenPath) {
  try {
    const raw = await fs.readFile(tokenPath, 'utf-8')
    return JSON.parse(raw)
  } catch (err) {
    if (err.code === 'ENOENT') return null
    console.warn('[auth] token.json is malformed or unreadable — will re-authenticate')
    try {
      await fs.unlink(tokenPath)
    } catch {
      // ignore unlink errors
    }
    return null
  }
}

/**
 * Saves token response fields to token.json.
 * @param {string} tokenPath
 * @param {object} result - MSAL token response
 */
async function saveTokenCache(tokenPath, result) {
  const data = {
    homeAccountId: result.account?.homeAccountId,
    refreshToken: result.refreshToken ?? null,
    accessToken: result.accessToken,
    expiresOn: result.expiresOn?.toISOString() ?? null,
    scopes: result.scopes ?? SCOPES,
  }
  await fs.writeFile(tokenPath, JSON.stringify(data, null, 2), 'utf-8')
}

/**
 * Acquires a valid Microsoft Graph access token.
 * Handles first-run interactive login and subsequent silent refresh.
 * @returns {Promise<string>} access token
 */
export async function acquireToken() {
  const tokenPath = process.env.MSAL_TOKEN_PATH ?? './token.json'
  const app = buildMsalApp()

  const cached = await loadTokenCache(tokenPath)

  // If we have a cached token that's still valid, return it directly
  if (cached?.accessToken && cached?.expiresOn) {
    const expiresOn = new Date(cached.expiresOn)
    if (expiresOn.getTime() - Date.now() > TOKEN_EXPIRY_BUFFER_MS) {
      return cached.accessToken
    }
  }

  // If we have a cached account, try silent refresh first
  if (cached?.homeAccountId) {
    try {
      const accounts = await app.getTokenCache().getAllAccounts()
      const account = accounts.find(a => a.homeAccountId === cached.homeAccountId)

      if (account) {
        const result = await app.acquireTokenSilent({ scopes: SCOPES, account })
        await saveTokenCache(tokenPath, result)
        return result.accessToken
      }
    } catch (err) {
      console.log('[auth] Silent token refresh failed. Re-authenticating interactively...')
      try {
        await fs.unlink(tokenPath)
      } catch {
        // ignore unlink errors
      }
    }
  }

  // Interactive auth code flow with PKCE (first run or after silent failure).
  // Opens the system browser to the Microsoft login page and captures the redirect
  // on http://localhost. Requires http://localhost registered as a redirect URI in
  // Azure portal: App Registration → Authentication → Mobile and desktop applications.
  try {
    const result = await app.acquireTokenInteractive({ scopes: SCOPES, openBrowser })
    await saveTokenCache(tokenPath, result)
    return result.accessToken
  } catch (err) {
    throw new Error(`[auth] Authentication failed. Cannot continue. (${err.message})`)
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const token = await acquireToken()
  console.log('[auth] Token acquired successfully.')
  console.log('[auth] First 20 chars:', token.substring(0, 20) + '...')
}
