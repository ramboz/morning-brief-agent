import 'dotenv/config'
import fs from 'fs/promises'
import { fileURLToPath } from 'url'
import { Octokit } from '@octokit/rest'
import { isMock, isSaveFixture } from '../utils/flags.js'
import { loadConfig, fetchGithubNotifications } from './githubShared.js'

/**
 * Fetches GitHub.com notifications for the authenticated user.
 * Filters and enriches results according to config/github.json.
 * @param {Date} since - Lookback start time
 * @returns {Promise<{ ok: boolean, data?: { instance: string, notifications: object[] }, error?: string }>}
 */
export async function fetchGithubDotCom(since) {
  if (isMock) {
    try {
      const fixture = JSON.parse(await fs.readFile('tests/fixtures/github-com.json', 'utf-8'))
      return fixture
    } catch {
      return { ok: false, error: 'Mock fixture not found: tests/fixtures/github-com.json' }
    }
  }

  const token = process.env.GITHUB_COM_TOKEN
  if (!token) return { ok: false, error: 'GitHub.com token missing — check GITHUB_COM_TOKEN in .env' }

  const configResult = await loadConfig()
  if (!configResult.ok) return { ok: false, error: configResult.error }

  const octokit = new Octokit({ auth: token })

  try {
    return await fetchGithubNotifications(octokit, 'github.com', configResult.config, since)
  } catch (err) {
    if (err.status === 401) return { ok: false, error: 'GitHub.com token invalid — check GITHUB_COM_TOKEN in .env' }
    if (err.status === 403 && err.response?.headers['x-ratelimit-remaining'] === '0') {
      return { ok: false, error: 'GitHub.com rate limit exceeded' }
    }
    const networkCode = err.cause?.code ?? err.code
    if (networkCode === 'ECONNREFUSED' || networkCode === 'ENOTFOUND') {
      return { ok: false, error: 'GitHub.com unreachable — check network' }
    }
    return { ok: false, error: `GitHub.com fetch failed: ${err.message}` }
  }
}

// Standalone runner
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const result = await fetchGithubDotCom(since)
  console.log(JSON.stringify(result, null, 2))

  if (isSaveFixture) {
    await fs.writeFile('tests/fixtures/github-com.json', JSON.stringify(result, null, 2))
    console.log('[github-com] Fixture saved to tests/fixtures/github-com.json')
  }
}
