# 🌅 Morning Briefing Agent

A personal productivity agent that runs every morning and produces a markdown daily note summarizing your key work tools — so you can start your day knowing where to show up and what to act on.

---

## What It Does

Each morning, the agent fetches from all configured sources in parallel, summarizes them with Claude, and writes a single daily note:

- 💬 **Slack** — Highlights direct @mentions, thread updates (replies to threads you were part of), DMs awaiting a response, and open discussions in priority channels where your input would be valuable
- 🎫 **JIRA** — Identifies tickets where your review, decision, or input is needed today — and open discussions worth joining, not just what changed
- 📖 **Wiki** — Surfaces pages with open discussions, active RFCs, or direct mentions that deserve your attention — not just a list of recent edits
- 💻 **GitHub** — Highlights PRs awaiting your review, issues assigned to you, and open discussions across github.com and your corporate instance where your engagement matters

> **Not yet implemented (pending MS Graph admin approval):** Outlook email and Teams activity. Stubs are in the template but show `_Nothing to report._` until those sources are enabled.

All sources are fault-tolerant — if JIRA is down or GitHub is unreachable, the briefing still runs and notes which sources were unavailable.

---

## How It Works

```
node src/index.js [--dry-run]
          ↓
   Fetch all sources in parallel
   (Slack · JIRA · Confluence · GitHub × 2)
          ↓
   Summarize each source via Claude API
          ↓
   Synthesize Action Items + Focus Areas across all sources
          ↓
   Write daily note → {output}/YYYY-MM-DD.md
```

---

## Daily Note Structure

```markdown
# Daily Brief — 2026-03-02

> ⏱️ Last updated: 08:02 — 4 sources • 8 items

## ⚡ Action Items
- [ ] [Slack] spacecat-api-service #1892 — review requested by @zehnder
- [ ] [JIRA] ENG-1204 — Alice is blocked on token refresh, needs your decision
- [ ] [Wiki] Review ASO Onboarding (v133) — Sean updated patterns blocking customers

## 🔥 Focus Areas
### ASO Onboarding & Customer Unblocking
- [Slack] @bordeian: Dover Corp blocked on IP allowlisting — needs your guidance
- [Wiki] Onboarding playbook updated (v133) — affects customer pipeline

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

## 🎫 JIRA
### Needs Your Input
### Discussions to Join

## 📖 Wiki
### Pages Needing Attention

## 💻 GitHub
### github.com
### Corporate GitHub
```

---

## Prerequisites

- **Node.js 20+** (`node --version` to check)
- **Claude Code CLI** installed and authenticated (used for AI summarization via `claude -p` — no API key needed, uses your existing Claude subscription). Alternatively, an OpenAI-compatible API key.
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

Open `.env` and fill in the values for the sources you want to enable.

### 3. Create your config files

```bash
cp config/slack.example.json config/slack.json
cp config/jira.example.json config/jira.json
cp config/confluence.example.json config/confluence.json
cp config/github.example.json config/github.json
```

Edit each file with your settings. For Slack, configure which channels get full summaries:

```json
{
  "channels": ["#eng-general", "#incidents", "#product"]
}
```

Only channels listed here get full summaries — everything else is checked for mentions only.

### 4. Install git hooks

```bash
npx husky init
```

### 5. Run a dry-run to verify everything works

```bash
node src/index.js --dry-run
```

Check `./output/YYYY-MM-DD.md` to see your first briefing.

### 6. Run live

```bash
node src/index.js
```

Output goes to `./output/YYYY-MM-DD.md` by default, or to the path set via `--output` or `OUTPUT_PATH`.

---

## Environment Variables

Copy `.env.example` to `.env` and fill in each value.

### Slack

| Variable | How to get it |
|---|---|
| `SLACK_USER_TOKEN` | api.slack.com/apps → your app → OAuth & Permissions → User OAuth Token (`xoxp-...`) |
| `SLACK_CONFIG_PATH` | Leave as `./config/slack.json` |

### JIRA (self-hosted)

| Variable | How to get it |
|---|---|
| `JIRA_BASE_URL` | Your JIRA instance URL, e.g. `https://jira.yourcompany.com` |
| `JIRA_API_TOKEN` | JIRA → Profile → Personal Access Tokens → Create token |
| `JIRA_CONFIG_PATH` | Leave as `./config/jira.json` |

### Confluence (self-hosted)

| Variable | How to get it |
|---|---|
| `CONFLUENCE_BASE_URL` | Your Confluence instance URL, e.g. `https://confluence.yourcompany.com` |
| `CONFLUENCE_API_TOKEN` | Confluence → Profile → Personal Access Tokens → Create token |
| `CONFLUENCE_CONFIG_PATH` | Leave as `./config/confluence.json` |

### GitHub

| Variable | How to get it |
|---|---|
| `GITHUB_COM_TOKEN` | github.com → Settings → Developer settings → Personal access tokens |
| `GITHUB_CONFIG_PATH` | Leave as `./config/github.json` |
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

### Output

| Variable | Default | Description |
|---|---|---|
| `OUTPUT_PATH` | `./output` | Directory to write daily notes into. Overridden by `--output` flag. |

### Behaviour

| Variable | Default | Description |
|---|---|---|
| `LOOKBACK_HOURS` | `24` | How many hours back to fetch. Automatically extended to 72h on Mondays. |
| `LOG_DIR` | `./logs` | Directory for daily log files |

---

## Flags Reference

```bash
node src/index.js                          # Normal run
node src/index.js --dry-run                # No writes — output to ./output/
node src/index.js --output ./notes         # Write note to ./notes/ instead of default
node src/index.js --mock                   # Use saved fixtures, skip live APIs
node src/index.js --mock --dry-run         # Fully offline — no API calls, no writes
node src/index.js --debug                  # Verbose debug logging for all sources
node src/index.js --days 3                 # Look back 3 days instead of default 24h
node src/index.js --model haiku            # Use a specific Claude model for summarization
```

### --dry-run
Always use when testing changes. All sources are fetched and summarized normally — nothing is written to the output directory.

### --output \<path\>
Writes the daily note to the specified directory instead of `OUTPUT_PATH` or `./output`. The note is always named `YYYY-MM-DD.md`.

### --mock
Run the full pipeline against saved fixture files instead of live APIs. Requires fixtures in `tests/fixtures/` — save them with `--save-fixture` on any source runner.

### --debug
Enables verbose logging for all source modules — pagination progress, query timings, item counts, AI call details.

### --days N
Overrides `LOOKBACK_HOURS` for this run. Useful after returning from PTO (`--days 14`). Monday auto-extend (72h back to Friday) still applies when no flag is set.

### --model \<name\>
Passes `--model <name>` to the Claude CLI backend. Ignored when `AI_BACKEND=openai`.

---

## Testing

### Saving Fixtures

After implementing each source, save a fixture for offline testing:

```bash
node src/sources/slack.js --save-fixture
node src/sources/jira.js --save-fixture
node src/sources/confluence.js --save-fixture
node src/sources/githubDotCom.js --save-fixture
node src/sources/githubCorp.js --save-fixture
```

Fixtures are saved to `tests/fixtures/` and gitignored.

### Running Offline

Once fixtures exist, test the full pipeline with no external calls:

```bash
node src/index.js --mock --dry-run
```

This is the primary way to iterate on prompt quality without waiting for live data.

### No Test Framework

No Jest or Vitest. Standalone runners + `--save-fixture` + `--mock --dry-run` cover all practical testing needs for a personal tool.

---

## Debugging Individual Sources

Every source module can be run standalone:

```bash
node src/sources/slack.js          # Fetch and print raw Slack data
node src/sources/jira.js           # Fetch JIRA ticket activity
node src/sources/confluence.js     # Fetch Confluence changes
node src/sources/githubDotCom.js   # Fetch github.com notifications
node src/sources/githubCorp.js     # Fetch corporate GitHub notifications
```

Each prints JSON output for that source. Useful for verifying credentials and checking what data is available.

---

## Project Structure

```
morning-briefing/
├── .claude/
│   └── skills/
│       └── implement-phase.md   # Claude Code skill for implementing phases
├── config/
│   ├── slack.example.json       # Copy to slack.json and configure
│   ├── jira.example.json
│   ├── confluence.example.json
│   └── github.example.json
├── specs/                       # Spec-driven development specs
├── src/
│   ├── auth/
│   │   └── msalClient.js        # MSAL token acquisition (for future Outlook/Teams)
│   ├── sources/
│   │   ├── slack.js             # Slack mentions, DMs, channel summaries
│   │   ├── jira.js              # JIRA REST API v2 (self-hosted)
│   │   ├── confluence.js        # Confluence REST API (self-hosted)
│   │   ├── githubDotCom.js      # github.com notifications
│   │   ├── githubCorp.js        # Corporate GitHub notifications
│   │   └── githubShared.js      # Shared GitHub fetch/filter/enrich logic
│   ├── ai/
│   │   └── summarize.js         # All AI summarization calls (claude-cli or openai)
│   ├── output/
│   │   └── dailyNote.js         # Assemble + smart-merge the daily note
│   ├── utils/
│   │   ├── flags.js             # CLI flags, debug helper, lookback calculation
│   │   └── context.js           # Loads config/context.md for AI personalization
│   └── index.js                 # Orchestrator — entry point
├── output/                      # Note output (gitignored)
├── logs/                        # Daily log files (gitignored)
├── tests/fixtures/              # Saved API responses for mock mode (gitignored)
├── CLAUDE.md                    # Project conventions for Claude Code
├── .env.example
└── package.json
```

---

## Smart Merge — How Re-runs Work

Running the script more than once in a day **updates** the existing daily note rather than replacing it. Each section is bounded by an `<!-- AGENT:{key} -->` anchor — only the content between anchors is replaced.

- ✅ Notes you've written outside sections are never touched
- ✅ The header timestamp and source/item counts are updated on each run
- ✅ Re-running after connecting to VPN merges JIRA/Confluence/Corp GitHub data in

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
fix(jira): handle pagination for large issue sets
prompt(confluence): tune filtering to reduce noise from deprioritized pages
```

---

## License

MIT
