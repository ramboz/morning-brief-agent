/**
 * Shared fetch utility for Atlassian (JIRA DC + Confluence DC) REST APIs.
 * Handles basic auth and common error patterns.
 */

/**
 * Make an authenticated request to an Atlassian DC instance.
 * @param {string} baseUrl - Instance base URL (e.g. https://jira.yourcompany.com)
 * @param {string} path - API path (e.g. /rest/api/2/search)
 * @param {string} user - Username or email
 * @param {string} token - API token or password
 * @param {object} [options] - Additional fetch options
 * @returns {Promise<object>} Parsed JSON response
 * @throws {Error} On network or auth failure
 */
export async function atlassianFetch(baseUrl, path, user, token, options = {}) {
  const url = `${baseUrl}${path}`
  const auth = Buffer.from(`${user}:${token}`).toString('base64')

  const res = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...options.headers
    }
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`${res.status} ${res.statusText} — ${url}\n${body.slice(0, 200)}`)
  }

  return res.json()
}
