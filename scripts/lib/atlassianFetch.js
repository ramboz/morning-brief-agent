/**
 * Shared fetch utility for Atlassian (JIRA DC + Confluence DC) REST APIs.
 * Uses Personal Access Token (PAT) Bearer auth — no username required.
 * PATs for self-hosted DC are created at:
 *   JIRA:       https://jira.yourcompany.com/secure/ViewProfile.jspa → Personal Access Tokens
 *   Confluence: https://confluence.yourcompany.com/secure/ViewProfile.jspa → Personal Access Tokens
 */

/**
 * Make an authenticated request to an Atlassian DC instance using Bearer PAT auth.
 * @param {string} baseUrl - Instance base URL (e.g. https://jira.yourcompany.com)
 * @param {string} path - API path (e.g. /rest/api/2/search)
 * @param {string} token - Personal Access Token
 * @param {object} [options] - Additional fetch options (method, body, headers, etc.)
 * @returns {Promise<object>} Parsed JSON response
 * @throws {Error} On network or HTTP error. HTTP errors have `err.status` set to the HTTP status code.
 */
export async function atlassianFetch(baseUrl, path, token, options = {}) {
  const url = `${baseUrl}${path}`

  const res = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...options.headers
    }
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    const err = new Error(`${res.status} ${res.statusText} — ${url}\n${body.slice(0, 200)}`)
    err.status = res.status
    throw err
  }

  return res.json()
}
