/**
 * Diagnostic script for Microsoft Graph / Outlook API access.
 * Uses authorization code + PKCE flow (browser redirect, no client secret).
 *
 * Usage:
 *   node scripts/diag-outlook.js
 *
 * On first run: opens your browser for sign-in, receives the redirect on
 * localhost:3000, exchanges the code for a token. Subsequent runs reuse the
 * cached token (or refresh it automatically).
 *
 * Output: full HTTP response status, headers, and body for each Graph endpoint.
 * Share this output with admins to diagnose access issues.
 *
 * Azure App requirement: redirect URI http://localhost:3000 must be added under
 * the "Mobile and desktop applications" platform in the app registration.
 */

import 'dotenv/config';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { createServer } from 'http';
import { exec } from 'child_process';
import { createHash, randomBytes } from 'crypto';

const TENANT_ID  = process.env.AZURE_TENANT_ID;
const CLIENT_ID  = process.env.AZURE_CLIENT_ID;
const TOKEN_PATH = resolve(process.env.MSAL_TOKEN_PATH ?? './token.json');
const PORT       = 3000;
const REDIRECT_URI = `http://localhost:${PORT}`;

const SCOPES = [
  'https://graph.microsoft.com/User.Read',
  'https://graph.microsoft.com/Mail.Read',
  'offline_access',
];

const GRAPH_ENDPOINTS = [
  { label: 'Profile (me)',        url: 'https://graph.microsoft.com/v1.0/me' },
  { label: 'Inbox folder',        url: 'https://graph.microsoft.com/v1.0/me/mailFolders/inbox' },
  { label: 'Messages (top 1)',    url: 'https://graph.microsoft.com/v1.0/me/messages?$top=1&$select=subject,from,receivedDateTime' },
  { label: 'Mail folders (list)', url: 'https://graph.microsoft.com/v1.0/me/mailFolders?$top=5' },
];

// ── PKCE helpers ──────────────────────────────────────────────────────────────

function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function generatePKCE() {
  const verifier  = base64url(randomBytes(32));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

// ── OAuth2 helpers ────────────────────────────────────────────────────────────

async function postForm(url, params) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  return { status: res.status, headers: Object.fromEntries(res.headers), body: await res.json() };
}

// ── Authorization code + PKCE flow ────────────────────────────────────────────

async function authCodePKCEFlow() {
  const { verifier, challenge } = generatePKCE();
  const state = base64url(randomBytes(16));

  const authUrl = new URL(`https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/authorize`);
  authUrl.searchParams.set('client_id',             CLIENT_ID);
  authUrl.searchParams.set('response_type',         'code');
  authUrl.searchParams.set('redirect_uri',          REDIRECT_URI);
  authUrl.searchParams.set('scope',                 SCOPES.join(' '));
  authUrl.searchParams.set('code_challenge',        challenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  authUrl.searchParams.set('state',                 state);

  console.error('[diag-outlook] Starting local auth server on port', PORT);
  console.error('[diag-outlook] Opening browser for sign-in...');
  console.error('[diag-outlook] If the browser does not open, visit:\n ', authUrl.toString());

  // Start local redirect receiver
  const code = await new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const incoming = new URL(req.url, `http://localhost:${PORT}`);
      const error    = incoming.searchParams.get('error');
      const inCode   = incoming.searchParams.get('code');
      const inState  = incoming.searchParams.get('state');

      if (error) {
        const desc = incoming.searchParams.get('error_description') ?? '';
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(`<h2>Auth error: ${error}</h2><pre>${desc}</pre>`);
        server.close();
        reject(new Error(`Auth error: ${error} — ${desc}`));
        return;
      }

      if (inCode && inState === state) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<h2>Authentication successful — you can close this tab.</h2>');
        server.close();
        resolve(inCode);
      }
    });

    server.listen(PORT, () => {
      exec(`open "${authUrl.toString()}"`);
    });

    server.on('error', (err) => {
      reject(new Error(`Local server error: ${err.message}. Is port ${PORT} in use?`));
    });

    setTimeout(() => { server.close(); reject(new Error('Auth timeout (5 min)')); }, 300_000);
  });

  console.error('[diag-outlook] Received auth code — exchanging for token...');

  const tokenRes = await postForm(
    `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`,
    {
      client_id:     CLIENT_ID,
      grant_type:    'authorization_code',
      code,
      redirect_uri:  REDIRECT_URI,
      code_verifier: verifier,
    }
  );

  if (tokenRes.status === 200 && tokenRes.body.access_token) {
    const token = {
      access_token:  tokenRes.body.access_token,
      refresh_token: tokenRes.body.refresh_token,
      expires_at:    Date.now() + tokenRes.body.expires_in * 1000,
      scope:         tokenRes.body.scope,
    };
    writeFileSync(TOKEN_PATH, JSON.stringify(token, null, 2));
    console.error('[diag-outlook] Authenticated. Token cached to', TOKEN_PATH);
    return token.access_token;
  }

  console.error('[diag-outlook] Token exchange failed:');
  console.error('  Status:', tokenRes.status);
  console.error('  Headers:', JSON.stringify(tokenRes.headers, null, 2));
  console.error('  Body:', JSON.stringify(tokenRes.body, null, 2));
  process.exit(1);
}

// ── Token refresh ─────────────────────────────────────────────────────────────

async function tryRefresh(refreshToken) {
  const res = await postForm(
    `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`,
    {
      client_id:     CLIENT_ID,
      grant_type:    'refresh_token',
      refresh_token: refreshToken,
      scope:         SCOPES.join(' '),
    }
  );
  if (res.status === 200 && res.body.access_token) {
    const token = {
      access_token:  res.body.access_token,
      refresh_token: res.body.refresh_token ?? refreshToken,
      expires_at:    Date.now() + res.body.expires_in * 1000,
      scope:         res.body.scope,
    };
    writeFileSync(TOKEN_PATH, JSON.stringify(token, null, 2));
    console.error('[diag-outlook] Token refreshed.');
    return token.access_token;
  }
  console.error('[diag-outlook] Refresh failed:', res.body?.error, res.body?.error_description);
  return null;
}

// ── Token resolution ──────────────────────────────────────────────────────────

async function getAccessToken() {
  if (existsSync(TOKEN_PATH)) {
    const cached = JSON.parse(readFileSync(TOKEN_PATH, 'utf8'));
    if (cached.expires_at > Date.now() + 120_000) {
      console.error('[diag-outlook] Using cached token (expires in',
        Math.round((cached.expires_at - Date.now()) / 60000), 'min)');
      return cached.access_token;
    }
    if (cached.refresh_token) {
      console.error('[diag-outlook] Token expired — refreshing...');
      const refreshed = await tryRefresh(cached.refresh_token);
      if (refreshed) return refreshed;
    }
  }
  return authCodePKCEFlow();
}

// ── Graph diagnostic call ─────────────────────────────────────────────────────

async function diagCall(label, url, accessToken) {
  console.error(`[diag-outlook] Testing: ${label}`);
  try {
    const res = await fetch(url, {
      headers: {
        Authorization:      `Bearer ${accessToken}`,
        Accept:             'application/json',
        'Client-Request-Id': crypto.randomUUID(),
      },
    });
    const headers = Object.fromEntries(res.headers);
    let body;
    try { body = await res.json(); } catch { body = await res.text(); }
    return { label, url, status: res.status, headers, body };
  } catch (err) {
    return { label, url, error: err.message };
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

if (!TENANT_ID) { console.error('[diag-outlook] AZURE_TENANT_ID not set'); process.exit(1); }
if (!CLIENT_ID) { console.error('[diag-outlook] AZURE_CLIENT_ID not set'); process.exit(1); }

const accessToken = await getAccessToken();

const results = [];
for (const { label, url } of GRAPH_ENDPOINTS) {
  results.push(await diagCall(label, url, accessToken));
}

console.log(JSON.stringify({ timestamp: new Date().toISOString(), results }, null, 2));
