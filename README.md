# 🌅 Morning Briefing Agent

A personal productivity agent that runs every morning and produces an [Obsidian](https://obsidian.md) daily note summarizing the last 24 hours across all your key work tools — so you can start your day with full context in minutes.

---

## What It Does

Each morning, the agent:

- 📬 **Email** — Summarizes unread Outlook mail, classifies action items vs. FYI, saves draft replies for emails needing a response, and auto-archives newsletters and automated alerts
- 💬 **Slack** — Highlights direct @mentions, thread updates (replies to threads you were part of), DMs awaiting a response, and surfaces open discussions in priority channels where your input would be valuable
- 💬 **Yesterday's Meetings** — Fetches Teams meeting transcripts and summarizes key decisions, action items, and context from meetings you attended or need to catch up on
- 💬 **Teams Activity** — Surfaces @mentions from customer-facing Teams chats
- 🎫 **JIRA** — Identifies tickets where your review, decision, or input is needed today — and open discussions worth joining, not just what changed
- 📖 **Confluence** — Surfaces pages with open discussions, active RFCs, or direct mentions that deserve your attention — not just a list of recent edits
- 💻 **GitHub** — Highlights PRs awaiting your review, issues assigned to you, and open discussions across github.com and your corporate instance where your engagement matters

Everything is written into a single Obsidian daily note. Re-running during the day **smart-merges** new content without overwriting anything you've already written or checked off.

---

## How It Works

```
Every morning (Windows Task Scheduler)
          ↓
   node src/index.js [--dry-run]
          ↓
   Fetch all sources in parallel
   (Outlook · Slack · Teams · JIRA · Confluence · GitHub × 2)
          ↓
   Summarize each source via Claude API
          ↓
   Perform write operations
   (Save Outlook drafts · Archive/delete triaged email)
          ↓
   Synthesize Action Items across all sources
          ↓
   Write Obsidian daily note
   → {vault}/Daily Notes/YYYY-MM-DD.md
```

All sources are fault-tolerant — if JIRA is down or GitHub is unreachable, the briefing still runs and notes which sources were unavailable.

---

## Daily Note Structure

```markdown
# Daily Brief — 2026-03-02

> ⏱️ Last updated: 08:02 — 6 sources • 14 items

## ⚡ Action Items
- [ ] [Email] Reply to Jane re: Q1 roadmap input needed before Friday
- [ ] [Slack] Review PR #482 — Alice asked in #eng-general
- [ ] [JIRA] Ticket ENG-1204 needs your decision before release

## 📬 Email
### Action Required
### FYI / Reading
### Auto-Archived

## 💬 Slack
### 🔴 Mentions & Threads
### Thread Updates
### Direct Messages
### Priority Channels
### Other Channels

## 💬 Yesterday's Meetings

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

---

## Prerequisites

- **Node.js 20+** (`node --version` to check)
- **Git** (for commit hooks via husky)
- **An Obsidian vault** synced via Google Drive (or any local/synced folder)
- **Claude Code CLI** installed and authenticated (used for AI summarization via `claude -p` — no API key needed, uses your existing Claude subscription). Alternatively, an OpenAI-compatible API key.
- **Microsoft work account** with access to Outlook and Teams
- **Slack workspace** membership (user token — requires workspace admin approval to install the app)
- **JIRA + Confluence** personal API token (self-hosted)
- **GitHub personal access tokens** (one per GitHub instance)

---

## Setup

### 1. Clone the repo

```bash
git clone https://github.com/yourname/morning-briefing.git
cd morning-briefing
npm install
```

### 2. Copy and fill in environment variables

```bash
cp .env.example .env
```

Open `.env` and fill in all values. See [Environment Variables](#environment-variables) below for details on obtaining each credential.

### 3. Create your Slack config

```bash
cp config/slack.example.json config/slack.json
```

Edit `config/slack.json` with the channels you want full summaries for:

```json
{
  "channels": [
    "#eng-general", "#eng-backend", "#incidents",
    "#product", "#roadmap",
    "#general", "#announcements"
  ]
}
```

Use the exact channel names from Slack (with or without `#`). Only channels listed here get full summaries — everything else is checked for mentions only.

### 4. Install git hooks

```bash
npx husky init
```

Commit messages are enforced by commitlint. See [Commit Format](#commit-format) for the convention.

### 5. Authenticate with Microsoft (first run only)

```bash
node src/auth/msalClient.js
```

This opens a browser window for Microsoft login. Sign in with your work account. A `token.json` file is saved locally — subsequent runs refresh this silently.

> **Note:** `token.json` is gitignored. Never commit it.

### 6. Run a dry-run to verify everything works

```bash
node src/index.js --dry-run
```

In dry-run mode:
- No emails are archived or deleted
- No drafts are saved to Outlook
- The daily note is written to `./output/YYYY-MM-DD.md` instead of your vault

Check `./output/` to see your first briefing. Verify the content looks right for each source.

### 7. Run live

Once you're happy with the dry-run output (recommended: at least 5 dry runs):

```bash
node src/index.js
```

This writes to your Obsidian vault and performs live email triage.

### 8. Schedule with Windows Task Scheduler

Run the setup helper:

```bash
# Follow the instructions printed by this script
node scripts/setup-scheduler.js
```

Or manually:
1. Open **Task Scheduler** → **Create Basic Task**
2. Name: `Morning Briefing`
3. Trigger: **Daily** at your preferred start-of-day time
4. Action: **Start a program** → `scripts/run.bat`
5. Settings: **Run only when user is logged on**

---

## Environment Variables

Copy `.env.example` to `.env` and fill in each value.

### Microsoft Graph (Outlook + Teams)

| Variable | How to get it |
|---|---|
| `AZURE_CLIENT_ID` | Azure Portal → App registrations → your app → Overview → Application (client) ID |
| `AZURE_TENANT_ID` | Azure Portal → App registrations → your app → Overview → Directory (tenant) ID |
| `MSAL_TOKEN_PATH` | Leave as `./token.json` |

**Azure app setup:** See [docs/azure-app-setup.md](docs/azure-app-setup.md) for step-by-step instructions including required permissions.

### Slack

| Variable | How to get it |
|---|---|
| `SLACK_USER_TOKEN` | api.slack.com/apps → your app → OAuth & Permissions → User OAuth Token (`xoxp-...`) |
| `SLACK_CONFIG_PATH` | Leave as `./config/slack.json` |

**Slack app setup:** See [docs/slack-app-setup.md](docs/slack-app-setup.md) for step-by-step instructions including required scopes.

### JIRA (self-hosted)

| Variable | How to get it |
|---|---|
| `JIRA_BASE_URL` | Your JIRA instance URL, e.g. `https://jira.yourcompany.com` |
| `JIRA_USER` | Your JIRA login email |
| `JIRA_API_TOKEN` | JIRA → Profile → Personal Access Tokens → Create token |

### Confluence (self-hosted)

| Variable | How to get it |
|---|---|
| `CONFLUENCE_BASE_URL` | Your Confluence instance URL, e.g. `https://confluence.yourcompany.com` |
| `CONFLUENCE_USER` | Your Confluence login email |
| `CONFLUENCE_API_TOKEN` | Confluence → Profile → Personal Access Tokens → Create token |

### GitHub

| Variable | How to get it |
|---|---|
| `GITHUB_COM_TOKEN` | github.com → Settings → Developer settings → Personal access tokens → Fine-grained token with `notifications:read` |
| `GITHUB_CORP_BASE_URL` | Your corporate GitHub API URL, e.g. `https://github.yourcompany.com/api/v3` |
| `GITHUB_CORP_TOKEN` | Same process on your corporate GitHub instance |

### AI Backend

| Variable | Default | Description |
|---|---|---|
| `AI_BACKEND` | `claude-cli` | `claude-cli` uses Claude Code CLI (`claude -p`), no API key needed. `openai` uses an OpenAI-compatible API. |
| `OPENAI_API_KEY` | — | Only needed if `AI_BACKEND=openai` |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | OpenAI-compatible endpoint (also works with ChatGPT Enterprise) |
| `OPENAI_MODEL` | `gpt-4o` | Model for the OpenAI backend |
| `AI_TIMEOUT_MS` | `300000` | Timeout per AI call in ms (5 min default) |

### Obsidian

| Variable | Example |
|---|---|
| `OBSIDIAN_VAULT_PATH` | `C:/Users/yourname/Google Drive/MyVault` |
| `OBSIDIAN_DAILY_NOTES_FOLDER` | `Daily Notes` |
| `OBSIDIAN_DATE_FORMAT` | `YYYY-MM-DD` |

### Behaviour

| Variable | Default | Description |
|---|---|---|
| `LOOKBACK_HOURS` | `24` | How many hours back to fetch from each source |
| `LOG_DIR` | `./logs` | Directory for daily log files |

---

## Flags Reference

```bash
node src/index.js                          # Normal run
node src/index.js --dry-run                # No writes — output to ./output/
node src/index.js --mock                   # Use saved fixtures, skip live APIs
node src/index.js --mock --dry-run         # Fully offline — no API calls, no writes
node src/index.js --debug                  # Verbose debug logging for all sources
node src/index.js --days 3                 # Look back 3 days instead of default 24h
node src/index.js --model haiku            # Use a specific Claude model for summarization
node src/sources/outlook.js --save-fixture # Save live API response as fixture
```

### --dry-run
Always use when testing changes:
- ✅ All sources are fetched normally
- ✅ All AI summarization runs normally
- ❌ No emails are archived or deleted
- ❌ No Outlook drafts are saved
- ❌ Vault is not written to — output goes to `./output/YYYY-MM-DD.md`
- 📝 All would-be actions are logged to console

### --mock
Run the full pipeline against saved fixture files instead of live APIs:
- ✅ No API credentials needed
- ✅ Fast — no network calls
- ✅ Ideal for tuning Claude prompts without burning API credits
- Requires fixtures to exist in `tests/fixtures/` — save them first with `--save-fixture`

### --debug
Enables verbose debug logging for all source modules. Shows pagination progress, query timings, item counts, and AI call details. Useful for diagnosing slow runs or API issues.

### --days N
Overrides `LOOKBACK_HOURS` for this run. Useful for Monday mornings (`--days 3`) or returning from PTO (`--days 14`). Supports `--days 3` (space) and `--days=3` (equals) syntax.

### --model \<name\>
Passes `--model <name>` to the Claude CLI backend. Use `--model haiku` for faster summarization at the cost of slightly less nuanced output. Ignored when `AI_BACKEND=openai`.

### --save-fixture
On any standalone source runner, saves the live API response to `tests/fixtures/{source}.json`.
Run this after each phase to build up your offline test suite.

---

## Testing

### Saving Fixtures

After implementing each source, save a fixture for offline testing:

```bash
node src/sources/outlook.js --save-fixture
node src/sources/slack.js --save-fixture
node src/sources/jira.js --save-fixture
# etc.
```

Fixtures are saved to `tests/fixtures/` and gitignored. Rebuild them any time your data changes significantly.

### Running Offline

Once fixtures exist, test the full pipeline with no external calls:

```bash
node src/index.js --mock --dry-run
```

Check `./output/YYYY-MM-DD.md` — this is the primary way to iterate on prompt quality.

### No Test Framework

No Jest or Vitest. The combination of standalone runners, `--save-fixture`, and `--mock --dry-run` covers all practical testing needs for a personal tool.

---

## Debugging Individual Sources

Every source module can be run standalone to test it in isolation:

```bash
node src/auth/msalClient.js        # Verify Microsoft auth token
node src/sources/outlook.js        # Fetch and print raw email data
node src/sources/slack.js          # Fetch and print raw Slack data
node src/sources/teams.js          # Fetch Teams activity + transcripts
node src/sources/jira.js           # Fetch JIRA ticket activity
node src/sources/confluence.js     # Fetch Confluence changes
node src/sources/githubDotCom.js   # Fetch github.com notifications
node src/sources/githubCorp.js     # Fetch corporate GitHub notifications
```

Each prints JSON output for that source. Useful for verifying credentials and checking what data is available before running the full briefing.

---

## Project Structure

```
morning-briefing/
├── .claude/
│   ├── skills/
│   │   └── implement-phase.md   # Claude Code skill for implementing phases
│   └── README.md
├── docs/
│   ├── azure-app-setup.md       # Step-by-step Azure app registration guide
│   └── slack-app-setup.md       # Step-by-step Slack app creation guide
├── scripts/
│   ├── run.bat                  # Task Scheduler entry point — redirects output to logs/
│   └── setup-scheduler.js       # Task Scheduler configuration helper
├── specs/                       # Spec-driven development specs
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
│   │   └── msalClient.js        # MSAL token acquisition + silent refresh
│   ├── sources/
│   │   ├── outlook.js           # Outlook mail via Graph API
│   │   ├── slack.js             # Slack mentions, DMs, channel summaries
│   │   ├── teams.js             # Teams activity + meeting transcripts
│   │   ├── jira.js              # JIRA REST API v2 (self-hosted)
│   │   ├── confluence.js        # Confluence REST API (self-hosted)
│   │   ├── githubDotCom.js      # github.com notifications
│   │   ├── githubCorp.js        # Corporate GitHub notifications
│   │   └── githubShared.js      # Shared GitHub fetch/filter/enrich logic
│   ├── ai/
│   │   └── summarize.js         # All AI summarization calls (claude-cli or openai)
│   ├── output/
│   │   └── dailyNote.js         # Assemble + smart-merge Obsidian daily note
│   ├── utils/
│   │   └── flags.js             # CLI flags, debug helper, lookback calculation
│   └── index.js                 # Orchestrator — entry point
├── output/                      # Dry-run output (gitignored)
├── CLAUDE.md                    # Project conventions for Claude Code
├── .env.example
├── .env                         # Your secrets (gitignored)
├── token.json                   # MSAL refresh token (gitignored)
└── package.json
```

---

## Smart Merge — How Re-runs Work

Running the script more than once in a day **updates** the existing daily note rather than replacing it:

- ✅ Items you've checked off (`- [x]`) are **never removed**
- ✅ Notes you've added between sections are **never touched**
- ✅ New items are **prepended** at the top of each section
- ✅ Existing items are **updated in place** if the same source item reappears (e.g. a JIRA ticket that's still active)
- ✅ The header timestamp and item count are updated

This makes the daily note a living document you can work in throughout the day — not just a static morning snapshot.

---

## Email Triage

The agent classifies each email into one of five categories:

| Category | Action |
|---|---|
| `action_required` | Kept in inbox, appears in briefing, draft reply saved if appropriate |
| `fyi` | Kept in inbox, appears in briefing as reading item |
| `newsletter` | Archived |
| `marketing` | Archived |
| `automated_alert` | Archived |
| `junk` | Moved to Deleted Items |

**Auto-triage only activates after 5 dry runs.** Until then, all triage decisions are logged but no emails are moved. This gives you time to verify the classification is working correctly for your inbox before enabling live mode.

If Claude is uncertain about a classification, it defaults to `fyi` — never auto-archives ambiguous emails.

---

## Known Limitations

- **Teams channel messages** require `ChannelMessage.Read.All` which needs IT admin consent. Currently using the Teams activity feed and SharePoint transcript files as a workaround. Full channel message history can be enabled later once admin consent is granted.
- **Slack sidebar sections** are not available via the Slack API — priority channels are configured as a flat list in `config/slack.json`.
- **Meeting transcripts** require Teams meetings to have been recorded. The script skips meetings without transcripts silently.
- **MSAL token refresh** requires the user to be logged in. If you restart your machine and don't log in before the scheduled run time, the script may fail to refresh silently and log an error.

---

## Development

### Adding a New Source

1. Create `src/sources/yourSource.js` following the pattern in any existing source
2. Add `summarizeYourSource()` to `src/ai/summarize.js`
3. Add the fetch call to `src/index.js` `Promise.allSettled()` array
4. Add rendering to `src/output/dailyNote.js`
5. Add the new section to the daily note template in `specs/10-output.md`

See `.claude/skills/implement-phase.md` for the full workflow checklist.

### Modifying Summarization Prompts

All prompts are named constants at the top of `src/ai/summarize.js`. Edit them directly and test with:

```bash
node src/index.js --dry-run
```

Check `./output/YYYY-MM-DD.md` to evaluate the output quality.

---

## Commit Format

This project uses [Conventional Commits](https://www.conventionalcommits.org/) enforced by commitlint + husky.

```
<type>(<scope>): <description>
```

| Type | When to use |
|---|---|
| `feat` | New source, new feature, new phase implemented |
| `fix` | Bug fix |
| `chore` | Dependencies, config, tooling |
| `docs` | README, specs, CLAUDE.md |
| `prompt` | Claude prompt changes in `summarize.js` |
| `refactor` | Restructuring with no behaviour change |

**Examples:**
```
feat(slack): implement Slack source with channel config
fix(outlook): handle 429 rate limit with Retry-After header
prompt(email): tune triage to reduce false positives for newsletters
docs: add Azure app setup guide
```

---

## Contributing

This is a personal tool — PRs are welcome but the primary purpose is to serve one user's specific workflow. If you fork it, update `CLAUDE.md` with your own preferences and rebuild the specs to match your stack.

---

## License

MIT
