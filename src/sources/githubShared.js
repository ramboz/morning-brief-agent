import fs from 'fs/promises'
import { debug } from '../utils/flags.js'

const BODY_MAX_CHARS = 500

/**
 * Loads and validates the GitHub config file.
 * Falls back to all-enabled defaults if config is missing (log warning only).
 * @returns {Promise<{ ok: boolean, config?: object, error?: string }>}
 */
export async function loadConfig() {
  const configPath = process.env.GITHUB_CONFIG_PATH ?? './config/github.json'
  let raw
  try {
    raw = await fs.readFile(configPath, 'utf-8')
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.warn(`[github] config not found at ${configPath} — using defaults (all notifications enabled)`)
      return { ok: true, config: defaultConfig() }
    }
    return { ok: false, error: `Failed to read GitHub config: ${err.message}` }
  }

  try {
    return { ok: true, config: JSON.parse(raw) }
  } catch {
    return { ok: false, error: 'GitHub config is not valid JSON' }
  }
}

function defaultConfig() {
  const defaults = {
    notifications: {
      prs_to_review: true,
      pr_activity: true,
      issues_assigned: true,
      issues_opened: true,
      mentions: true,
      ci_failures: true,
      repo_activity: true,
    },
    orgs: [],
  }
  return { 'github.com': defaults, corporate: { ...defaults, orgs: [] } }
}

/**
 * Strips common markdown formatting from text before truncation.
 * @param {string} text
 * @returns {string}
 */
function stripMarkdown(text) {
  if (!text) return ''
  return text
    .replace(/```[\s\S]*?```/g, '[code]')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/#{1,6}\s+/g, '')
    .replace(/[*_]{1,2}([^*_\n]+)[*_]{1,2}/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Returns whether a notification passes the config filter flags.
 * @param {object} notification - Raw GitHub notification
 * @param {object} filters - Notification filter flags from config
 * @returns {boolean}
 */
function shouldInclude(notification, filters) {
  const { reason, subject } = notification
  const type = subject.type

  if (filters.prs_to_review && reason === 'review_requested') return true
  if (filters.pr_activity && reason === 'author' && type === 'PullRequest') return true
  if (filters.issues_assigned && reason === 'assign') return true
  if (filters.issues_opened && reason === 'author' && type === 'Issue') return true
  if (filters.mentions && (reason === 'mention' || reason === 'team_mention')) return true
  if (filters.ci_failures && reason === 'ci_activity') return true
  // repo_activity covers comment, state_change (PR merged/closed), and subscribed
  if (filters.repo_activity && (reason === 'comment' || reason === 'state_change' || reason === 'subscribed')) return true

  return false
}

/**
 * Fetches CI check runs for a PR's head SHA and returns failures.
 * @param {object} octokit
 * @param {string} owner
 * @param {string} repo
 * @param {string} sha
 * @returns {Promise<{ ciStatus: string|null, ciFailures: object[] }>}
 */
async function checkCiFailures(octokit, owner, repo, sha) {
  try {
    const { data } = await octokit.checks.listForRef({ owner, repo, ref: sha, per_page: 10 })
    const failures = (data.check_runs ?? [])
      .filter(r => r.conclusion === 'failure' || r.conclusion === 'cancelled')
      .map(r => ({ name: r.name, conclusion: r.conclusion }))
    return {
      ciStatus: failures.length > 0 ? 'failing' : 'passing',
      ciFailures: failures,
    }
  } catch (err) {
    if (err.status === 404) return { ciStatus: null, ciFailures: [] }
    throw err
  }
}

/**
 * Returns a minimal notification shape when enrichment is unavailable.
 * @param {object} notification
 * @returns {object}
 */
function mapBasic(notification) {
  const { reason, subject, repository, updated_at } = notification
  return {
    id: notification.id,
    type: subject.type,
    reason,
    repo: repository.full_name,
    title: subject.title,
    url: repository.html_url,
    author: null,
    state: null,
    isDraft: false,
    updatedAt: updated_at,
    ciStatus: null,
    ciFailures: [],
    labels: [],
    body: null,
  }
}

/**
 * Enriches a raw notification with subject details (PR/issue/commit/release).
 * Returns null if the notification should be dropped (e.g. ci_activity with no failures).
 * @param {object} octokit
 * @param {object} notification
 * @param {object} filters
 * @returns {Promise<object|null>}
 */
async function enrichNotification(octokit, notification, filters) {
  const { reason, subject, repository, updated_at } = notification
  const [owner, repo] = repository.full_name.split('/')

  let subjectData
  try {
    const response = await octokit.request(`GET ${subject.url}`)
    subjectData = response.data
  } catch (err) {
    if (err.status === 404) return mapBasic(notification)
    throw err
  }

  const base = {
    id: notification.id,
    type: subject.type,
    reason,
    repo: repository.full_name,
    updatedAt: updated_at,
    title: subject.title,
    url: repository.html_url,
    author: null,
    state: null,
    isDraft: false,
    ciStatus: null,
    ciFailures: [],
    labels: [],
    body: null,
  }

  if (subject.type === 'PullRequest') {
    const pr = subjectData
    base.title = pr.title
    base.url = pr.html_url
    base.author = pr.user?.login ?? null
    base.state = pr.merged_at ? 'merged' : (pr.state ?? null)
    base.isDraft = pr.draft ?? false
    base.body = stripMarkdown(pr.body ?? '').slice(0, BODY_MAX_CHARS)

    if (filters.ci_failures && pr.head?.sha) {
      const ci = await checkCiFailures(octokit, owner, repo, pr.head.sha)
      base.ciStatus = ci.ciStatus
      base.ciFailures = ci.ciFailures
    }

    // ci_activity notifications are only useful when CI is actually failing
    if (reason === 'ci_activity' && base.ciFailures.length === 0) return null

  } else if (subject.type === 'Issue') {
    const issue = subjectData
    base.title = issue.title
    base.url = issue.html_url
    base.author = issue.user?.login ?? null
    base.state = issue.state ?? null
    base.labels = (issue.labels ?? []).map(l => l.name)
    base.body = stripMarkdown(issue.body ?? '').slice(0, BODY_MAX_CHARS)

  } else if (subject.type === 'Commit') {
    const commit = subjectData
    base.title = commit.commit?.message?.split('\n')[0] ?? subject.title
    base.url = commit.html_url
    base.author = commit.commit?.author?.name ?? commit.author?.login ?? null

  } else if (subject.type === 'Release') {
    const release = subjectData
    base.title = release.name ?? release.tag_name
    base.url = release.html_url
    base.author = release.author?.login ?? null
    base.body = stripMarkdown(release.body ?? '').slice(0, BODY_MAX_CHARS)
  }

  return base
}

/**
 * Fetches, filters, and enriches GitHub notifications for a given instance.
 * @param {import('@octokit/rest').Octokit} octokit
 * @param {'github.com'|'corporate'} instance
 * @param {object} config - Parsed github.json config
 * @param {Date} since
 * @returns {Promise<{ ok: boolean, data?: { instance: string, notifications: object[] }, error?: string }>}
 */
export async function fetchGithubNotifications(octokit, instance, config, _since) {
  const label = instance === 'github.com' ? '[github.com]' : '[github-corp]'
  const instanceConfig = config[instance] ?? {}
  const filters = instanceConfig.notifications ?? {
    prs_to_review: true, pr_activity: true, issues_assigned: true,
    issues_opened: true, mentions: true, ci_failures: true,
  }
  const allowedOrgs = instanceConfig.orgs ?? []

  debug(label, 'Fetching unread notifications...')
  const t0 = Date.now()
  const rawNotifications = await octokit.paginate(
    octokit.activity.listNotificationsForAuthenticatedUser,
    { all: false, per_page: 100 }
  )
  debug(label, `${rawNotifications.length} raw notifications fetched in ${Date.now() - t0}ms`)

  const filtered = rawNotifications
    .filter(n => allowedOrgs.length === 0 || allowedOrgs.includes(n.repository?.owner?.login))
    .filter(n => shouldInclude(n, filters))
  debug(label, `${filtered.length} after filtering (${rawNotifications.length - filtered.length} excluded by config/org)`)

  const t1 = Date.now()
  const notifications = []
  for (const n of filtered) {
    try {
      debug(label, `Enriching ${n.subject?.type} "${n.subject?.title?.slice(0, 60)}"...`)
      const enriched = await enrichNotification(octokit, n, filters)
      if (enriched) notifications.push(enriched)
    } catch (err) {
      console.warn(`[github] enrichment failed for ${n.id} (${n.subject?.title}): ${err.message}`)
      notifications.push(mapBasic(n))
    }
  }
  debug(label, `${notifications.length} notifications enriched in ${Date.now() - t1}ms`)

  return { ok: true, data: { instance, notifications } }
}
