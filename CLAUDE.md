# CLAUDE.md — Morning Briefing Agent

This is the project bible. Read this before writing any code. Follow these conventions strictly.

---

## What This Project Does

A personal productivity agent that runs every morning and produces an Obsidian daily note helping you decide where to show up and what to act on today — across email, meetings, Teams activity, JIRA, Confluence, GitHub, and Slack. It saves email draft responses to Outlook Drafts and auto-triages obvious junk mail.

The core philosophy: **not what happened yesterday, but where you need to show up today.** Every source is filtered through the question "does this need my attention?" rather than "what changed?"

---

## Runtime & Language

- **Node.js 20+**, ESM modules throughout (`"type": "module"` in package.json)
- **No TypeScript** — plain JS with JSDoc comments for type hints where helpful
- **No build step** — runs directly with `node src/index.js`
- **No transpilation** — use native ESM, top-level await is fine

---

## Project Structure

```
morning-briefing/
├── CLAUDE.md
├── specs/
│   ├── 00-architecture.md
│   ├── 01-phase-plan.md
│   ├── 02-auth.md
│   ├── 03-outlook.md
│   ├── 04-slack.md
│   ├── 05-teams.md
│   ├── 06-jira.md
│   ├── 07-confluence.md
│   ├── 08-github.md
│   ├── 09-summarization.md
│   └── 10-output.md
├── src/
│   ├── auth/
│   │   └── msalClient.js        # MSAL token acquisition + refresh
│   ├── sources/
│   │   ├── outlook.js           # Mail + drafts via Graph API
│   │   ├── slack.js             # Slack mentions, DMs, priority channels
│   │   ├── teams.js             # Activity feed + transcripts via SharePoint
│   │   ├── jira.js              # Self-hosted JIRA REST API v2
│   │   ├── confluence.js        # Self-hosted Confluence REST API
│   │   ├── githubDotCom.js      # github.com notifications via Octokit
│   │   ├── githubCorp.js        # Corporate GitHub notifications via Octokit
│   │   └── githubShared.js      # Shared GitHub fetch/filter/enrich logic
│   ├── ai/
│   │   └── summarize.js         # All AI summarization calls (claude-cli or openai)
│   ├── output/
│   │   └── dailyNote.js         # Assembles + writes Obsidian daily note
│   ├── utils/
│   │   └── flags.js             # CLI flags, debug helper, lookback calculation
│   └── index.js                 # Orchestrator — entry point
├── tests/
│   └── fixtures/                # Saved API responses for offline/mock testing
├── logs/                        # Daily log files (gitignored)
├── output/                      # Dry-run note output (gitignored)
├── scripts/
│   ├── run.bat                  # Task Scheduler entry point
│   └── setup-scheduler.js       # Task Scheduler setup helper
├── .claude/
│   ├── skills/
│   │   └── implement-phase.md
│   └── README.md
├── config/
│   ├── github.example.json      # Committed — copy to github.json and fill in
│   ├── jira.example.json        # Committed — copy to jira.json and fill in
│   ├── confluence.example.json  # Committed — copy to confluence.json and fill in
│   └── slack.example.json       # Committed — copy to slack.json and fill in
├── commitlint.config.js         # Commitlint configuration
├── .husky/
│   └── commit-msg               # Git hook — runs commitlint
├── .env.example
├── .env                         # gitignored
├── token.json                   # gitignored — MSAL refresh token storage
└── package.json
```

---

## Code Conventions

### Async
- Always `async/await`, never `.then()` chains or callbacks
- Use `Promise.allSettled()` when fetching from multiple sources in parallel — never `Promise.all()` (one failure must not crash the briefing)

### Error Handling — Critical Rule
Every source module must be independently fault-tolerant. If JIRA is down, the briefing still runs with a note saying "JIRA unavailable". Pattern to follow:

```js
async function fetchJira() {
  try {
    // ... fetch logic
    return { ok: true, data: [...] }
  } catch (err) {
    console.error('[jira] fetch failed:', err.message)
    return { ok: false, error: err.message }
  }
}
```

The orchestrator (`index.js`) always uses `Promise.allSettled()` and handles both `ok: true` and `ok: false` results.

### VPN-Gated Sources
JIRA, Confluence, and Corporate GitHub are only reachable on VPN. These sources use `!err.status` to distinguish network errors (no HTTP status = unreachable) from HTTP errors (always have a `.status`). When a network error is detected:
- The **user-info probe** (the first API call in each module) re-throws the error immediately so expensive queries are skipped
- The module returns `{ ok: false, error: 'Source unreachable — are you on VPN?' }`
- The orchestrator renders this as `_Skipped — not on VPN_` (not `_Source unavailable_`)

Re-running after connecting to VPN smart-merges the new data into the existing daily note.

### Environment Variables
- All secrets and config via `.env` — never hardcoded
- Always read via `process.env.X` with a clear error if missing
- See `.env.example` for all required variables

### Secrets — Never Commit
`.gitignore` must include:
```
.env
token.json
logs/
output/
tests/fixtures/
config/github.json
config/jira.json
config/confluence.json
config/slack.json
```

### Logging
- Use `console.error('[module]', ...)` for errors
- Use `console.log('[module]', ...)` for progress
- Use `debug('[module]', ...)` from `src/utils/flags.js` for verbose debug output (only shows when `--debug` flag is set)
- Debug logs use the convention `[module]:debug message` and include pagination progress, query timings, item counts, and API call details
- No external logging libraries
- When running via Task Scheduler, stdout and stderr are redirected to `logs/YYYY-MM-DD.log` by `scripts/run.bat`
- Log files are gitignored and rotate naturally — one file per day, old files accumulate until manually cleared

### Config File Pattern

Service-specific config lives in `config/{service}.json`. Example files (`config/{service}.example.json`) are committed to the repo. Actual config files are gitignored. Every source module that uses a config file must:
- Fail clearly with a helpful message if the config file is missing (don't silently use defaults that might be wrong)
- Validate required fields (e.g. `projects` array for JIRA) before making any API calls
- Support a `lookback_hours_override` field that overrides the global `LOOKBACK_HOURS` env var

---

### No Over-Engineering
This is a personal tool. Prefer:
- Simple functions over classes
- Flat logic over abstractions
- Explicit over clever
- Don't add caching, queuing, or retry logic unless a spec requires it

---

## CLI Flags

The script supports the following flags:

```bash
node src/index.js                          # Normal run
node src/index.js --dry-run                # No writes, output to ./output/
node src/index.js --mock                   # Use fixture files, skip live APIs
node src/index.js --mock --dry-run         # Full offline test — no API calls, no writes
node src/index.js --debug                  # Verbose debug logging for all sources
node src/index.js --days 3                 # Look back 3 days instead of default 24h
node src/index.js --model haiku            # Use a specific Claude model for summarization
```

### --dry-run
- No emails are archived or deleted
- No Outlook drafts are saved
- Daily note written to `./output/YYYY-MM-DD.md` instead of vault
- All would-be actions logged to console

### --mock
- Each source reads from `tests/fixtures/{source}.json` instead of calling live APIs
- MSAL token acquisition is skipped entirely
- Summarization and output still run normally
- Always combine with `--dry-run` unless you want to write to the vault with fixture data

### --debug
- Enables verbose debug logging for all source modules
- Shows pagination progress, query timings, item counts, and AI call details
- Useful for diagnosing slow runs or API issues

### --days N
- Overrides `LOOKBACK_HOURS` for this run
- Useful for returning from PTO (`--days 14`)
- Supports `--days 3` (space) and `--days=3` (equals) syntax
- **Monday auto-extend:** when run on a Monday with no `--days` flag, lookback is automatically extended to 72h (back to Friday) — no flag needed

### --model \<name\>
- Passes `--model <name>` to the Claude CLI backend (e.g. `--model haiku` for faster summarization)
- Ignored when `AI_BACKEND=openai`

### Flag helpers (src/utils/flags.js)
```js
export const isDryRun = process.argv.includes('--dry-run')
export const isMock = process.argv.includes('--mock')
export const isSaveFixture = process.argv.includes('--save-fixture')
export const isDebug = process.argv.includes('--debug')
export const lookbackHours = /* --days flag > Monday auto-extend (72h) > LOOKBACK_HOURS env > 24h default */
export const aiModel = /* --model flag, null if not set */
export function debug(label, ...args) { /* no-op unless --debug */ }
```

`isDryRun` and `isMock` must be checked before **every** write operation and API call respectively.

---

## Environment Variables Reference

```bash
# Microsoft / Graph API (⚠️ deferred — pending admin approval)
AZURE_CLIENT_ID=
AZURE_TENANT_ID=
MSAL_TOKEN_PATH=./token.json

# JIRA (self-hosted DC — PAT used as Bearer token)
JIRA_BASE_URL=https://jira.yourcompany.com
JIRA_API_TOKEN=
JIRA_CONFIG_PATH=./config/jira.json

# Confluence (self-hosted DC — PAT used as Bearer token)
CONFLUENCE_BASE_URL=https://confluence.yourcompany.com
CONFLUENCE_API_TOKEN=
CONFLUENCE_CONFIG_PATH=./config/confluence.json

# GitHub.com
GITHUB_COM_TOKEN=
GITHUB_CONFIG_PATH=./config/github.json

# Corporate GitHub
GITHUB_CORP_BASE_URL=https://github.yourcompany.com/api/v3
GITHUB_CORP_TOKEN=

# Slack
SLACK_USER_TOKEN=xoxp-...
SLACK_CONFIG_PATH=./config/slack.json

# AI Backend: "claude-cli" (uses Claude Code CLI, no API key) or "openai"
AI_BACKEND=claude-cli

# OpenAI / ChatGPT Enterprise (only needed if AI_BACKEND=openai)
OPENAI_API_KEY=
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o

# Timeout per AI call in ms (default 5 min; claude-cli can be slow on first run)
AI_TIMEOUT_MS=300000

# Obsidian vault path
OBSIDIAN_VAULT_PATH=C:/Users/yourname/Google Drive/MyVault
OBSIDIAN_DAILY_NOTES_FOLDER=Daily Notes
OBSIDIAN_DATE_FORMAT=YYYY-MM-DD

# Behaviour
LOOKBACK_HOURS=24
LOG_DIR=./logs
```

---

## AI Summarization

All summarization calls are centralized in `src/ai/summarize.js` — no other file calls the AI directly. Two backends are supported, selected via `AI_BACKEND` env var:

### `claude-cli` (default)
Invokes `claude -p "<prompt>"` as a subprocess. Requires Claude Code to be installed and authenticated. No API key or billing needed — uses your existing Claude subscription. System prompt and user content are combined into a single string passed to `-p`. Supports `--model <name>` override via CLI flag.

The Claude CLI sometimes wraps JSON output in markdown code fences (`` ```json ... ``` ``). A `parseJSONResponse()` helper strips these before parsing.

### `openai`
Calls an OpenAI-compatible chat completions API. Works with `api.openai.com` and ChatGPT Enterprise endpoints (`OPENAI_BASE_URL`). Requires `OPENAI_API_KEY`. Uses `response_format.json_schema` for structured output enforcement.

### Shared conventions
- Each source has its own summarization function with a named prompt constant
- Prompts live at the top of `summarize.js` as `const PROMPT_X = ...` — never inline
- JSON schemas (`const SCHEMA_X = ...`) define expected output shapes — enforced via `response_format` on OpenAI, used for documentation on `claude-cli`
- Max tokens per call: 1000 (ignored by `claude-cli` backend)
- The final "Action Items" synthesis gets a separate call with all source summaries as input

---

## Output Format

The Obsidian daily note follows this exact markdown structure (section headers must match exactly — the output module depends on them):

```markdown
# Daily Brief — {{DATE}}

## ⚡ Action Items
## 📬 Email
### Action Required
### FYI / Reading
### Auto-Archived
## 💬 Yesterday's Meetings
## 💬 Slack
### 🔴 Mentions & Threads
### Thread Updates
### Direct Messages
### Priority Channels
### Other Channels
## 💬 Teams Activity
### Customer Mentions
## 🎫 JIRA
### Needs Your Input
### Discussions to Join
## 📖 Confluence
### Pages Needing Attention
## 💻 GitHub
### github.com
### Corporate GitHub
```

If a section has no content, write: `_Nothing to report._`

If a source was unreachable due to VPN (network error), write: `_Skipped — not on VPN_`

If a source failed for any other reason, write: `_Source unavailable: {error message}_`

---

## Running Each Source Standalone

Every source module must be runnable directly for debugging:

```bash
node src/sources/outlook.js                  # Run against live API, print JSON
node src/sources/outlook.js --save-fixture   # Run + save output to tests/fixtures/
node src/sources/jira.js
# etc.
```

Each source file should have a standalone runner at the bottom that supports both flags:
```js
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const result = await fetchOutlook(token, since)
  console.log(JSON.stringify(result, null, 2))

  if (process.argv.includes('--save-fixture')) {
    await fs.writeFile('tests/fixtures/outlook.json', JSON.stringify(result, null, 2))
    console.log('[outlook] Fixture saved to tests/fixtures/outlook.json')
  }
}
```

---

## Testing & Mock Mode

### Fixtures
After implementing each phase, save a fixture from the live API response:

```bash
node src/sources/outlook.js --save-fixture
# Saves to tests/fixtures/outlook.json
```

Every standalone runner must support `--save-fixture`:
```js
if (process.argv.includes('--save-fixture')) {
  await fs.writeFile(
    `tests/fixtures/${moduleName}.json`,
    JSON.stringify(result, null, 2)
  )
  console.log(`[${moduleName}] Fixture saved`)
}
```

### Mock Mode
Run the full pipeline against saved fixtures instead of live APIs:

```bash
node src/index.js --mock --dry-run
```

In mock mode:
- Each source reads from `tests/fixtures/{source}.json` instead of calling the API
- MSAL token acquisition is skipped
- All other logic (summarization, output) runs normally
- Combine with `--dry-run` to test the full pipeline with zero external calls

This is the primary way to tune Claude prompts without burning API credits or waiting for real data.

Every source module must check `isMock` before making any API call:
```js
export const isMock = process.argv.includes('--mock')

// In fetchOutlook():
if (isMock) {
  const fixture = JSON.parse(await fs.readFile('tests/fixtures/outlook.json', 'utf-8'))
  return fixture
}
// ...real fetch logic
```

### No Test Framework
No Jest or other test framework. Standalone runners + mock mode cover all practical testing needs for this project.

---

## Commit Conventions

This project uses [Conventional Commits](https://www.conventionalcommits.org/) enforced by commitlint + husky.

### Format
```
<type>(<scope>): <description>

[optional body]

[optional footer — list TODOs here]
```

### Types
| Type | When to use |
|---|---|
| `feat` | New source module, new feature, new spec implemented |
| `fix` | Bug fix in existing functionality |
| `chore` | Dependency updates, config changes, tooling |
| `docs` | README, specs, CLAUDE.md updates |
| `prompt` | Changes to Claude API prompts in summarize.js |
| `refactor` | Code restructuring with no behaviour change |

### Scopes (optional but encouraged)
`auth`, `outlook`, `slack`, `teams`, `jira`, `confluence`, `github`, `ai`, `output`, `config`

### Examples
```
feat(slack): implement Slack source module with channel config

fix(outlook): handle 429 rate limit with Retry-After header

prompt(slack): tune channel summary to reduce noise from bot messages

chore: add commitlint + husky git hooks

docs: update README with Task Scheduler setup instructions
```

### Setup (Phase 1)
Install dev dependencies:
```bash
npm install --save-dev @commitlint/cli @commitlint/config-conventional husky
npx husky init
echo "npx --no -- commitlint --edit $1" > .husky/commit-msg
```

`commitlint.config.js`:
```js
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [2, 'always', [
      'feat', 'fix', 'chore', 'docs', 'prompt', 'refactor'
    ]]
  }
}
```

---

## What Claude Code Should NOT Do

- Do not add TypeScript
- Do not add a web server or API layer
- Do not add a database
- Do not use `require()` — ESM only
- Do not install lodash, axios, or other utility libraries unless truly necessary (Node fetch is built-in)
- Do not create React or frontend code
- Do not abstract things "for future flexibility" — build exactly what the spec says