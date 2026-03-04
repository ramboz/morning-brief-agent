# Phase Plan — Morning Briefing Agent

Each phase is a self-contained Claude Code session. Start a new session for each phase.
Always begin each session with: **"Read CLAUDE.md and specs/00-architecture.md before writing any code."**

---

## Phase 1 — Project Scaffold + Auth

**Goal:** Working repo with full scaffold, stubbed MSAL auth (MS Graph pending admin approval), and the config/ folder pattern in place.

**Deliverables:**
- `package.json` with correct dependencies, `"type": "module"`, and dev dependencies for commitlint + husky
- `commitlint.config.js`
- `.husky/commit-msg` hook
- `.env.example` with all variables from CLAUDE.md
- `.gitignore` (includes `.env`, `token.json`, `logs/`, `output/`, `tests/fixtures/`, `config/*.json`)
- `src/utils/flags.js` — `isDryRun`, `isMock`, `isSaveFixture`, `isDebug`, `debug()`, `lookbackHours` (with Monday auto-extend), `aiModel` helpers
- `src/auth/msalClient.js` — **stub only**: `acquireToken()` logs "MS Graph pending admin approval" and returns `null`. Full implementation deferred to Phase 6.
- `src/index.js` — skeleton orchestrator (imports sources, calls `Promise.allSettled`, logs results, writes to log file)
- `logs/` directory created (gitignored)
- `output/` directory created (gitignored)
- `tests/fixtures/` directory created (gitignored)
- `config/` directory with all example config files committed, actual configs gitignored:
  - `config/github.example.json`
  - `config/jira.example.json`
  - `config/confluence.example.json`
  - `config/slack.example.json`
- `scripts/run.bat` — redirects stdout/stderr to `logs/YYYY-MM-DD.log`
- Proof: `node src/index.js --dry-run` runs without errors and prints "Briefing complete" 

**Claude Code Prompt:**
```
Read CLAUDE.md and specs/00-architecture.md before writing any code.

Scaffold the morning-briefing Node.js project:

1. Create package.json with:
   - "type": "module"
   - dependencies: @azure/msal-node, @anthropic-ai/sdk, @octokit/rest, @slack/web-api, dotenv
   - devDependencies: @commitlint/cli, @commitlint/config-conventional, husky

2. Create commitlint.config.js as specified in CLAUDE.md

3. Set up husky:
   - Initialize with: npx husky init
   - Create .husky/commit-msg with: npx --no -- commitlint --edit $1

4. Create .env.example and .gitignore as specified in CLAUDE.md
   (gitignore must include: .env, token.json, logs/, output/, tests/fixtures/, config/slack.json)

5. Create src/utils/flags.js exporting isDryRun, isMock, isSaveFixture as specified in CLAUDE.md

6. Create directory stubs (with .gitkeep): logs/, output/, tests/fixtures/

7. Create config/slack.example.json:
   {
     "channels": [
       "#channel-one", "#channel-two", "#channel-three"
     ]
   }

8. Create src/auth/msalClient.js as a stub:
   - Export acquireToken() that logs "[auth] MS Graph pending admin approval — skipping" and returns null
   - Add a TODO comment referencing specs/02-auth.md for the full implementation
   - Standalone runner at bottom that prints the null result

9. Create the config/ directory with example files (copy from specs):
   - config/github.example.json  (see specs/08-github.md for schema)
   - config/jira.example.json    (see specs/06-jira.md for schema)
   - config/confluence.example.json (see specs/07-confluence.md for schema)
   - config/slack.example.json   (see specs/04-slack.md for schema)

10. Create src/index.js as a skeleton that:
    - Loads .env via dotenv
    - Reads LOG_DIR from env, creates today's log file path
    - Has placeholder Promise.allSettled([]) with a comment for each source
    - Logs "Briefing complete" with duration at the end

11. Create scripts/run.bat that:
    - cd to the project directory
    - Runs: node src/index.js >> logs\YYYY-MM-DD.log 2>&1
    - Uses dynamic date in the log filename

Do not implement any source modules yet.
Do not implement full MSAL auth yet — that is Phase 6.
```

---

## Phase 2 — Outlook (Email)

**Goal:** Fetch unread emails from last 24h, classify them, save drafts, archive/delete in dry-run mode.

**Spec to write before this phase:** `specs/03-outlook.md`

**Deliverables:**
- `src/sources/outlook.js`
- Returns structured data: `{ emails: [{ id, subject, from, date, body, triage }] }`
- Triage classification happens in `src/ai/summarize.js` (partial — email only)
- Draft saving via Graph API (`POST /me/messages` with `isDraft: true`)
- Archive/delete gated by `isDryRun`
- Standalone runner works

**Claude Code Prompt:**
```
Read CLAUDE.md, specs/00-architecture.md, and specs/03-outlook.md before writing any code.

Implement src/sources/outlook.js:

1. fetchOutlook(accessToken, since) function that:
   - Fetches unread emails received after `since` from /me/messages (Graph API)
   - Fetches max 50 emails, selects: id, subject, from, receivedDateTime, bodyPreview, body
   - Returns { ok: true, data: { emails: [...] } } or { ok: false, error: string }

2. saveEmailDraft(accessToken, draft) function that:
   - Creates a draft in Outlook Drafts folder via POST /me/messages
   - draft shape: { to, subject, body }
   - Respects isDryRun (logs instead of calling API if dry-run)

3. triageEmail(accessToken, emailId, action) function that:
   - action is 'archive' or 'delete'
   - Archive: PATCH /me/messages/{id} to move to Archive folder
   - Delete: POST /me/messages/{id}/move to Deleted Items
   - Respects isDryRun

4. Standalone runner at bottom that:
   - Supports --save-fixture flag (saves to tests/fixtures/outlook.json)
   - Respects isMock (reads from tests/fixtures/outlook.json instead of calling API)

Do not implement summarization yet — just return raw email data.
Do not implement src/ai/summarize.js yet.
```

---

## Phase 3 — Summarization (Claude API) + Email Summary

**Goal:** Wire up Claude API, summarize emails, produce the Email section of the daily note.

**Spec to write before this phase:** `specs/08-summarization.md`

**Deliverables:**
- `src/ai/summarize.js` with `summarizeEmails()` function
- Returns structured result: `{ actionRequired: [], fyi: [], autoArchived: [], drafts: [] }`
- `src/output/dailyNote.js` — partial, Email section only
- Proof: running `node src/index.js --dry-run` produces a valid markdown file with Email section

**Claude Code Prompt:**
```
Read CLAUDE.md, specs/00-architecture.md, and specs/08-summarization.md before writing any code.

Implement src/ai/summarize.js with a summarizeEmails(emails) function:

1. Calls Claude API (claude-sonnet-4-20250514, max_tokens: 1000)
2. Prompt instructs Claude to:
   - Classify each email as: action_required, fyi, newsletter, automated_alert, or junk
   - For action_required emails: write a 1-2 sentence summary + suggested draft reply
   - For fyi: write a 1-sentence summary
   - For newsletter/automated_alert/junk: just classify, no summary needed
   - Return JSON only (no markdown, no preamble)
3. Returns parsed JSON: { actionRequired: [], fyi: [], autoArchived: [], drafts: [] }
4. Store the prompt as a named constant, not inline

Then implement src/output/dailyNote.js with:
1. buildDailyNote(sections) that assembles the full markdown using the template in CLAUDE.md
2. writeDailyNote(content) that writes to the vault path (or ./output/ in dry-run)
3. A partial renderEmail(emailSummary) function for the Email section only

Update src/index.js to:
- Call fetchOutlook + summarizeEmails
- Call saveEmailDraft for each draft (respecting dry-run)
- Call triageEmail for newsletter/junk (respecting dry-run)  
- Write the daily note with Email section populated, other sections as "Nothing to report."
```

---

## Phase 4 — Slack

**Goal:** Fetch Slack mentions, DMs, and priority channel summaries. Add Slack section to daily note.

**Spec to write before this phase:** `specs/04-slack.md`

**Deliverables:**
- `config/slack.example.json` with flat priority channel list
- `src/sources/slack.js`
- `summarizeSlackMentions()`, `summarizeSlackDMs()`, `summarizeSlackThreads()`, `summarizeSlackChannels()` in `src/ai/summarize.js`
- Priority Channels section rendered in daily note
- Standalone runner works

**Claude Code Prompt:**
```
Read CLAUDE.md, specs/00-architecture.md, and specs/04-slack.md before writing any code.

Implement src/sources/slack.js with:

1. loadConfig(memberChannels) — reads config/slack.json (flat "channels" array),
   resolves channel names to IDs using pre-fetched member channel list,
   returns { ok: true, channels: [{ id, name }] }

2. fetchSlack(since) — main function that:
   a. Calls auth.test() to get the authenticated user's ID
   b. Fetches all member channels once via users.conversations (reused by loadConfig and countOtherChannelActivity)
   c. Fetches mentions via search.messages({ query: '<@userId>', count: 100 })
   d. Fetches thread updates (threads the user replied to that have new replies)
   e. Fetches full history for priority channels only (from config/slack.json)
   f. Fetches DM list and history for DMs with activity since `since` (pre-filtered by dm.latest.ts)
   g. Counts activity in non-priority channels (no full fetch — just metadata)
   h. Resolves all user IDs to display names (in-memory Map cache)
   i. Returns the full data shape defined in specs/04-slack.md

3. Standalone runner at bottom

Add summarizeSlackMentions(), summarizeSlackDMs(), summarizeSlackThreads(),
summarizeSlackChannels() to src/ai/summarize.js following the prompt guidance in specs/04-slack.md.

Update src/output/dailyNote.js with a "Priority Channels" section for Slack.

Update src/index.js to include Slack in the Promise.allSettled() call.
```

---

## Phase 5 — JIRA + Confluence

**Goal:** Add JIRA and Confluence sources, add their sections to the daily note.

**Specs to write before this phase:** `specs/05-jira.md`, `specs/06-confluence.md`

**Deliverables:**
- `src/sources/jira.js`
- `src/sources/confluence.js`
- `summarizeJira()` and `summarizeConfluence()` added to `src/ai/summarize.js`
- Daily note now includes JIRA and Confluence sections

**Claude Code Prompt:**
```
Read CLAUDE.md, specs/00-architecture.md, specs/06-jira.md, and specs/07-confluence.md before writing any code.

Implement src/sources/jira.js:
1. fetchJira(since) using JIRA_BASE_URL, JIRA_USER, JIRA_API_TOKEN from .env
2. Use Basic Auth: base64(user:token) in Authorization header
3. Query: issues updated in last LOOKBACK_HOURS hours where user is assignee, reporter, or mentioned
4. Use JIRA REST API v2 (/rest/api/2/search with JQL)
5. Return { ok, data: { issues: [{ id, key, summary, status, updated, comments: [] }] } }

Implement src/sources/confluence.js:
1. fetchConfluence(since) using CONFLUENCE_BASE_URL, CONFLUENCE_USER, CONFLUENCE_API_TOKEN
2. Use Basic Auth same as JIRA
3. Fetch recently modified pages (/rest/api/content?lastModified=...)
4. Return { ok, data: { pages: [{ id, title, space, url, lastModified, excerpt }] } }

Add summarizeJira(issues) and summarizeConfluence(pages) to src/ai/summarize.js.

Update src/index.js and src/output/dailyNote.js to include these sections.
```

---

## Phase 6 — GitHub (both instances)

**Goal:** Add GitHub notifications from both github.com and corporate GitHub.

**Spec to write before this phase:** `specs/08-github.md`

**Deliverables:**
- `src/sources/githubDotCom.js`
- `src/sources/githubCorp.js`
- `summarizeGithub()` in `src/ai/summarize.js`
- Daily note GitHub sections populated

**Claude Code Prompt:**
```
Read CLAUDE.md, specs/00-architecture.md, and specs/08-github.md before writing any code.

Implement src/sources/githubDotCom.js and src/sources/githubCorp.js:

Both files are nearly identical — the only difference is the baseUrl and token used.

1. Use @octokit/rest — Octokit instance with auth token
2. githubCorp uses baseUrl from GITHUB_CORP_BASE_URL
3. fetchGithubNotifications(since) function:
   - Calls octokit.activity.listNotificationsForAuthenticatedUser({ since, all: false })
   - For each notification, fetch the subject (PR, issue, etc.) to get a summary
   - Return { ok, data: { notifications: [{ type, title, repo, url, reason, updatedAt }] } }

Add summarizeGithub(notifications, label) to src/ai/summarize.js where label is 'github.com' or 'Corporate GitHub'.

Update src/index.js and dailyNote.js accordingly.
```

---

## Phase 7 — Action Items + Polish (Activity + Meeting Transcripts)

**Goal:** Add Teams activity feed and yesterday's meeting transcript summaries.

**Spec to write before this phase:** `specs/05-teams.md`

**Deliverables:**
- `src/sources/teams.js`
- `summarizeTeams()` and `summarizeMeetings()` in `src/ai/summarize.js`
- Daily note Teams and Yesterday's Meetings sections populated

**Claude Code Prompt:**
```
Read CLAUDE.md, specs/00-architecture.md, and specs/05-teams.md before writing any code.

Implement src/sources/teams.js with two functions:

1. fetchTeamsActivity(accessToken, since):
   - Calls Graph API /me/teamwork/sendActivityNotification (read path: /me/activities)
   - Actually use: GET /me/teamwork/installedApps or activity feed endpoint
   - Return mentions, replies to my messages, reactions in last 24h
   - Return { ok, data: { activities: [{ type, from, context, timestamp, url }] } }

2. fetchMeetingTranscripts(accessToken, since):
   - Query /me/onlineMeetings for meetings in lookback window
   - For each meeting, search OneDrive /me/drive/root:/Recordings/ for matching transcript files
   - Fetch .vtt file content and strip timestamps to get plain text
   - Return { ok, data: { meetings: [{ title, date, duration, transcript }] } }

Note: if the Graph API activity feed endpoint has changed, find the correct current endpoint.
Stub out any endpoint you cannot confirm and add a TODO comment.

Add summarizeTeamsActivity(activities) and summarizeMeetings(meetings) to src/ai/summarize.js.
Update src/index.js and dailyNote.js.
```

---

## Future — Cowork + MCP Migration (Post-CLI)

**Goal:** The final cross-source Action Items synthesis, plus cleanup and Task Scheduler setup.

**Claude Code Prompt:**
```
Read CLAUDE.md and specs/00-architecture.md before writing any code.

1. Add synthesizeActionItems(allSummaries) to src/ai/summarize.js:
   - Takes the summary output from all sources
   - Single Claude API call that produces a concise prioritized action list
   - Max 10 items, each with a source tag e.g. [Email], [JIRA], [GitHub]
   - This becomes the ⚡ Action Items section at the top of the daily note

2. Polish src/output/dailyNote.js:
   - Ensure all sections render correctly
   - "Nothing to report." for empty sections
   - Add a footer: "Generated at {timestamp} • {duration}ms"

3. Create scripts/run.bat:
   - Windows batch file to cd to project dir and run node src/index.js
   - Include instructions as comments for setting up Windows Task Scheduler

4. Update README.md with:
   - Prerequisites
   - First-run setup (Azure app, .env, node auth)
   - How to run manually
   - How to set up Task Scheduler
   - How to add --dry-run flag
```

---

## Spec Files to Write (Before Their Phase)

These specs should be written by you before handing each phase to Claude Code. They give Claude Code the behavioral detail it needs without you having to repeat yourself in every prompt.

| File | Key things to define |
|---|---|
| `specs/02-auth.md` | MSAL token storage format, error handling for expired tokens, re-auth flow |
| `specs/03-outlook.md` | Which Graph API fields to fetch, triage classification criteria, draft format |
| `specs/04-slack.md` | Token setup, config/slack.json format, rate limiting strategy, mention detection |
| `specs/05-teams.md` | Which activity types matter, transcript file format (.vtt parsing), fallback if no transcripts |
| `specs/06-jira.md` | JQL queries to use, which issue fields matter, comment handling |
| `specs/07-confluence.md` | Which spaces to watch, page change detection, what counts as "recent" |
| `specs/08-github.md` | Which notification types matter, how to handle both GitHub instances |
| `specs/09-summarization.md` | Prompt templates, JSON output schemas, tone/length guidelines for summaries |
| `specs/10-output.md` | Daily note template in full, date format, vault path handling, overwrite behavior |

---

## Tips for Working with Claude Code

- **One phase per session.** Don't try to do Phase 2 and 3 in the same session.
- **Always start with "Read CLAUDE.md"** — Claude Code reads files you point it to.
- **Run the standalone tests after each phase** before starting the next.
- **Commit after each phase** so you have clean rollback points.
- **If Claude Code goes off-spec**, paste the relevant spec section and say "follow the spec".
- **Save fixtures after each phase**: run each standalone runner with `--save-fixture` before moving on.
- **Dry-run everything** until you're confident in the triage logic — at least 5 runs.
- **Use `--mock --dry-run`** when tuning prompts — no API calls, fast iteration.