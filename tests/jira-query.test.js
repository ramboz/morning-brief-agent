import test from 'node:test'
import assert from 'node:assert/strict'
import {
  stripJiraMarkup,
  formatIssue,
  buildInProgressJql
} from '../scripts/lib/jira/query.js'

// Regression guard for the shared JIRA helpers extracted out of fetch-jira.js
// into lib/jira/query.js (slice 009-02). These are pure and were previously
// untested; both fetch-jira.js and list-inprogress.js now depend on them.

test('stripJiraMarkup: collapses code/noformat blocks and mentions', () => {
  assert.equal(stripJiraMarkup('{code:js}const x=1{code}'), '[code block]')
  assert.equal(stripJiraMarkup('{noformat}raw{noformat}'), '[block]')
  assert.equal(stripJiraMarkup('ping [~jdoe] please'), 'ping @jdoe please')
  assert.equal(stripJiraMarkup('has {color:red}macro{color} here'), 'has macro here')
  assert.equal(stripJiraMarkup(''), '')
  assert.equal(stripJiraMarkup(null), '')
  assert.equal(stripJiraMarkup(undefined), '')
})

test('formatIssue: maps core fields and marks assignedToMe only for reason "assigned"', () => {
  const raw = {
    key: 'SITES-100',
    fields: {
      summary: 'Do the thing',
      issuetype: { name: 'Story' },
      status: { name: 'In Review' },
      priority: { name: 'High' },
      labels: ['cwv'],
      updated: '2026-07-01T10:00:00.000+0000'
    }
  }
  const out = formatIssue(raw, 'assigned', 'https://jira.example.com')
  assert.equal(out.key, 'SITES-100')
  assert.equal(out.summary, 'Do the thing')
  assert.equal(out.type, 'Story')
  assert.equal(out.status, 'In Review')          // concrete status name preserved
  assert.equal(out.priority, 'High')
  assert.equal(out.assignedToMe, true)
  assert.equal(out.updatedAt, '2026-07-01T10:00:00.000+0000')
  assert.equal(out.url, 'https://jira.example.com/browse/SITES-100')

  const mentioned = formatIssue(raw, 'mentioned', 'https://jira.example.com')
  assert.equal(mentioned.assignedToMe, false)
})

test('formatIssue: tolerates missing fields with sensible defaults', () => {
  const out = formatIssue({ key: 'SITES-1' }, 'search', 'https://jira.example.com')
  assert.equal(out.summary, '')
  assert.equal(out.status, 'Unknown')
  assert.equal(out.priority, 'Unknown')
  assert.deepEqual(out.labels, [])
})

test('buildInProgressJql: AC1 — statusCategory query with NO lookback bound', () => {
  const jql = buildInProgressJql(['SITES', 'ASO'])
  assert.match(jql, /project in \(SITES, ASO\)/)
  assert.match(jql, /assignee = currentUser\(\)/)
  assert.match(jql, /statusCategory = "In Progress"/)
  assert.match(jql, /ORDER BY updated ASC/)
  // The whole point of the radar: it must NOT be lookback-bounded.
  assert.doesNotMatch(jql, /updated >=/)
})
