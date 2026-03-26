/**
 * Shared Microsoft Graph auth utility.
 * Uses OAuth2 authorization code + PKCE flow (browser redirect, no client secret).
 *
 * First call opens the browser for sign-in and caches the token.
 * Subsequent calls reuse or refresh the cached token automatically.
 *
 * Azure App requirement: redirect URI http://localhost:3000 must be added under
 * the "Mobile and desktop applications" platform in the app registration.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { createServer } from 'node:http'
import { exec } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { withRetry } from './config.js'

const PORT = 3000
const REDIRECT_URI = `http://localhost:${PORT}`

/** @param {Buffer} buf */
function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function generatePKCE() {
  const verifier = base64url(randomBytes(32))
  const challenge = base64url(createHash('sha256').update(verifier).digest())
  return { verifier, challenge }
}

/**
 * POST a form-encoded request and return { status, body }.
 * @param {string} url
 * @param {Record<string, string>} params
 */
async function postForm(url, params) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  })
  return { status: res.status, body: await res.json() }
}

/**
 * Run the interactive browser PKCE flow.
 * @param {string} tenantId
 * @param {string} clientId
 * @param {string[]} scopes
 * @param {string} tokenPath
 * @returns {Promise<string>} access_token
 */
async function authCodePKCEFlow(tenantId, clientId, scopes, tokenPath) {
  const { verifier, challenge } = generatePKCE()
  const state = base64url(randomBytes(16))

  const authUrl = new URL(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize`)
  authUrl.searchParams.set('client_id', clientId)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('redirect_uri', REDIRECT_URI)
  authUrl.searchParams.set('scope', scopes.join(' '))
  authUrl.searchParams.set('code_challenge', challenge)
  authUrl.searchParams.set('code_challenge_method', 'S256')
  authUrl.searchParams.set('state', state)

  console.error('[graph] Starting local auth server on port', PORT)
  console.error('[graph] Opening browser for sign-in...')
  console.error('[graph] If the browser does not open, visit:\n ', authUrl.toString())

  const code = await new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const incoming = new URL(req.url, `http://localhost:${PORT}`)
      const error = incoming.searchParams.get('error')
      const inCode = incoming.searchParams.get('code')
      const inState = incoming.searchParams.get('state')

      if (error) {
        const desc = incoming.searchParams.get('error_description') ?? ''
        res.writeHead(400, { 'Content-Type': 'text/html' })
        res.end(`<h2>Auth error: ${error}</h2><pre>${desc}</pre>`)
        server.close()
        reject(new Error(`Auth error: ${error} — ${desc}`))
        return
      }

      if (inCode && inState === state) {
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end('<h2>Authentication successful — you can close this tab.</h2>')
        server.close()
        resolve(inCode)
      }
    })

    server.listen(PORT, () => {
      exec(`open "${authUrl.toString()}"`)
    })

    server.on('error', (err) => {
      reject(new Error(`Local server error: ${err.message}. Is port ${PORT} in use?`))
    })

    setTimeout(() => { server.close(); reject(new Error('Auth timeout (5 min)')) }, 300_000)
  })

  console.error('[graph] Received auth code — exchanging for token...')

  const tokenRes = await postForm(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      client_id: clientId,
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
    }
  )

  if (tokenRes.status === 200 && tokenRes.body.access_token) {
    const token = {
      access_token: tokenRes.body.access_token,
      refresh_token: tokenRes.body.refresh_token,
      expires_at: Date.now() + tokenRes.body.expires_in * 1000,
      scope: tokenRes.body.scope,
    }
    writeFileSync(tokenPath, JSON.stringify(token, null, 2))
    console.error('[graph] Authenticated. Token cached to', tokenPath)
    return token.access_token
  }

  throw new Error(`Token exchange failed: ${tokenRes.status} — ${JSON.stringify(tokenRes.body)}`)
}

/**
 * Try to refresh an expired token.
 * @param {string} tenantId
 * @param {string} clientId
 * @param {string} refreshToken
 * @param {string[]} scopes
 * @param {string} tokenPath
 * @returns {Promise<string|null>} access_token or null on failure
 */
async function tryRefresh(tenantId, clientId, refreshToken, scopes, tokenPath) {
  const res = await postForm(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      client_id: clientId,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      scope: scopes.join(' '),
    }
  )
  if (res.status === 200 && res.body.access_token) {
    const token = {
      access_token: res.body.access_token,
      refresh_token: res.body.refresh_token ?? refreshToken,
      expires_at: Date.now() + res.body.expires_in * 1000,
      scope: res.body.scope,
    }
    writeFileSync(tokenPath, JSON.stringify(token, null, 2))
    console.error('[graph] Token refreshed.')
    return token.access_token
  }
  console.error('[graph] Refresh failed:', res.body?.error, res.body?.error_description)
  return null
}

/**
 * Get a valid Microsoft Graph access token.
 * Uses cached token if available and not expired, refreshes if possible,
 * otherwise runs the interactive PKCE browser flow.
 *
 * Required env vars: AZURE_TENANT_ID, AZURE_CLIENT_ID
 * Optional env var: MSAL_TOKEN_PATH (default: ./token.json)
 *
 * @param {string[]} [scopes] - OAuth scopes to request
 * @returns {Promise<string>} access_token
 */
export async function getGraphToken(scopes = [
  'https://graph.microsoft.com/User.Read',
  'https://graph.microsoft.com/Mail.Read',
  'https://graph.microsoft.com/Calendars.Read',
  'offline_access',
]) {
  const tenantId = process.env.AZURE_TENANT_ID
  const clientId = process.env.AZURE_CLIENT_ID
  const tokenPath = resolve(process.env.MSAL_TOKEN_PATH ?? './token.json')

  if (!tenantId) throw new Error('AZURE_TENANT_ID not set')
  if (!clientId) throw new Error('AZURE_CLIENT_ID not set')

  if (existsSync(tokenPath)) {
    const cached = JSON.parse(readFileSync(tokenPath, 'utf8'))
    if (cached.expires_at > Date.now() + 120_000) {
      console.error('[graph] Using cached token (expires in',
        Math.round((cached.expires_at - Date.now()) / 60000), 'min)')
      return cached.access_token
    }
    if (cached.refresh_token) {
      console.error('[graph] Token expired — refreshing...')
      const refreshed = await tryRefresh(tenantId, clientId, cached.refresh_token, scopes, tokenPath)
      if (refreshed) return refreshed
    }
  }

  return authCodePKCEFlow(tenantId, clientId, scopes, tokenPath)
}

/**
 * Make an authenticated GET request to Microsoft Graph.
 * Retries once on transient failures.
 * @param {string} accessToken
 * @param {string} url - Full Graph API URL
 * @returns {Promise<object>} Parsed JSON response
 * @throws {Error} On HTTP or network error
 */
export async function graphFetch(accessToken, url) {
  return withRetry(async () => {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      const err = new Error(`Graph ${res.status} ${res.statusText} — ${url}\n${body.slice(0, 300)}`)
      err.status = res.status
      throw err
    }
    return res.json()
  }, { label: `graph:${url.split('?')[0].split('/').slice(-2).join('/')}` })
}

/**
 * Make an authenticated POST request to Microsoft Graph (e.g. for /search/query).
 * @param {string} accessToken
 * @param {string} url - Full Graph API URL
 * @param {object} body - JSON body
 * @returns {Promise<object>} Parsed JSON response
 */
export async function graphPost(accessToken, url, body) {
  return withRetry(async () => {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      const err = new Error(`Graph ${res.status} ${res.statusText} — ${url}\n${text.slice(0, 300)}`)
      err.status = res.status
      throw err
    }
    return res.json()
  }, { label: `graph:POST:${url.split('?')[0].split('/').slice(-2).join('/')}` })
}
