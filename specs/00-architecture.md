# Architecture — Morning Briefing Agent

## Overview

A Node.js CLI script that runs locally each morning via Windows Task Scheduler. It fetches data from multiple sources in parallel, summarizes using the Claude API, and writes an Obsidian daily note to a Google Drive-synced vault.

---

## Execution Flow

```
node src/index.js [--dry-run] [--debug] [--days N] [--model haiku]
        │
        ├── Acquire Microsoft Graph token (MSAL, silent refresh)
        │
        ├── Fetch all sources in parallel (Promise.allSettled)
        │   ├── outlook.js        → unread emails
        │   ├── slack.js          → mentions, DMs, priority channel activity
        │   ├── teams.js          → activity feed + yesterday's meeting transcripts
        │   ├── jira.js           → ticket activity
        │   ├── confluence.js     → page changes
        │   ├── githubDotCom.js   → notifications
        │   └── githubCorp.js     → notifications
        │
        ├── Summarize each source via AI (claude-cli or openai backend)
        │   └── summarize.js      → one function per source
        │
        ├── Perform write operations (if not dry-run)
        │   ├── Save email drafts → Outlook Drafts folder (Graph API)
        │   └── Archive/delete obvious junk → Outlook (Graph API)
        │
        ├── Synthesize Action Items (Claude API — single call with all summaries)
        │
        └── Write Obsidian daily note
            └── dailyNote.js → {OBSIDIAN_VAULT_PATH}/{OBSIDIAN_DAILY_NOTES_FOLDER}/{DATE}.md
```

---

## Authentication Strategy

### Microsoft Graph (Outlook + Teams)
- **Flow:** MSAL PublicClientApplication, delegated permissions
- **First run:** Interactive browser login, saves refresh token to `token.json`
- **Subsequent runs:** Silent token refresh using saved refresh token
- **Scopes:** `Mail.Read`, `Mail.ReadWrite`, `Mail.Send`, `Calendars.Read`, `TeamsActivity.Read`, `OnlineMeetings.Read`, `Files.Read.All`, `offline_access`

### JIRA + Confluence (self-hosted)
- **Flow:** HTTP Basic Auth — `base64(user:api_token)` in Authorization header
- **No OAuth** — personal API token is sufficient for self-hosted

### GitHub (both instances)
- **Flow:** Personal Access Token in Authorization header
- **Library:** `@octokit/rest` — two separate instances, one per GitHub host

### AI Summarization
- **Default backend (`claude-cli`):** Invokes `claude -p "<prompt>"` as a subprocess. Uses the user's existing Claude subscription — no API key needed. Supports `--model <name>` override.
- **Alternative backend (`openai`):** OpenAI-compatible chat completions API. Uses `response_format.json_schema` for structured output. Requires `OPENAI_API_KEY`.

---

## Data Lookback Window

All sources fetch data from the last N hours, calculated once in `index.js` from `lookbackHours` (exported by `src/utils/flags.js`). The priority chain is: `--days N` CLI flag → `LOOKBACK_HOURS` env var → 24h default.

```js
import { lookbackHours } from './utils/flags.js'
const since = new Date(Date.now() - lookbackHours * 60 * 60 * 1000)
```

Individual source configs can override via `lookback_hours_override` in their `config/{service}.json`.

---

## Parallelism Model

```js
// index.js — fetch all sources simultaneously
const [email, slack, teams, jira, confluence, ghCom, ghCorp] = await Promise.allSettled([
  fetchOutlook(token, since),
  fetchSlack(since),
  fetchTeams(token, since),
  fetchJira(since),
  fetchConfluence(since),
  fetchGithubCom(since),
  fetchGithubCorp(since),
])

// Each result is { status: 'fulfilled', value: { ok, data } }
// or             { status: 'rejected', reason: Error }
// Both cases are handled gracefully
```

---

## Triage Logic (Email)

Auto-triage is applied to emails only. Classification is done by the Claude API summarization step, which returns a `triage` field per email:

| Classification | Action (live mode) | Action (dry-run) |
|---|---|---|
| `action_required` | Keep in inbox, include in briefing | Log only |
| `fyi` | Keep in inbox, include in briefing | Log only |
| `newsletter` | Archive | Log would-archive |
| `automated_alert` | Archive | Log would-archive |
| `junk` | Delete (move to Deleted Items) | Log would-delete |

Auto-triage only applies to emails where Claude returns high confidence. Borderline cases default to `fyi`.

**Dry-run is the default for the first 5 runs.** After that the user must explicitly remove `--dry-run` to enable live triage.

---

## Obsidian Output

- The script writes (or overwrites) today's daily note at:
  `{OBSIDIAN_VAULT_PATH}/{OBSIDIAN_DAILY_NOTES_FOLDER}/{DATE}.md`
- Date format is controlled by `OBSIDIAN_DATE_FORMAT` (default: `YYYY-MM-DD`)
- If the file already exists, it is **overwritten** (re-running the script refreshes the brief)
- In dry-run mode, output goes to `./output/{DATE}.md` instead

---

## Microsoft Graph — Teams Transcripts via SharePoint

Since `OnlineMeetingTranscript.Read.All` requires admin consent, transcripts are accessed via the SharePoint/OneDrive files API:

1. Query `OnlineMeetings` for meetings in the lookback window where the user was organizer or attendee
2. For each meeting, look for associated transcript files in:
   - User's OneDrive: `/drives/{driveId}/root:/Recordings/`
   - Channel SharePoint folders (if applicable)
3. Fetch `.vtt` or `.docx` transcript files and extract text
4. Summarize via Claude API

This approach uses only `Files.Read.All` and `OnlineMeetings.Read`, both approved without admin consent.

---

## Dependencies

```json
{
  "@azure/msal-node": "^2.x",
  "@octokit/rest": "^20.x",
  "@slack/web-api": "^7.x",
  "dotenv": "^16.x"
}
```

No HTTP client library needed — Node.js 20 built-in `fetch` is used for all REST calls (Graph API, JIRA, Confluence). AI summarization uses the Claude Code CLI (`claude -p`) by default — no AI SDK dependency needed.

---

## Windows Task Scheduler Setup

The script is invoked via a `.bat` wrapper:

```bat
@echo off
cd /d C:\path\to\morning-briefing
node src/index.js >> logs\briefing.log 2>&1
```

Scheduled as a Basic Task:
- Trigger: Daily, at your chosen start-of-day time
- Action: Run the `.bat` file
- "Run only when user is logged on" — required for MSAL interactive fallback

---

## Future Considerations (not in scope now)

- Teams channel messages (`ChannelMessage.Read.All`) — pending IT admin consent
- Interactive Obsidian plugin to trigger the script from within the vault
- Web UI for reviewing/sending drafts
