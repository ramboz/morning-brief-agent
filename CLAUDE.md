# CLAUDE.md — Morning Assistant v2

> **⚠️ Legacy Cowork-era bible (annotated 2026-07-02, spec 008-03).** This file
> predates the project's move to the Codex/jig, MCP/plugin-first workflow. The
> **current source of truth** is [`docs/product-vision.md`](docs/product-vision.md),
> [`docs/architecture.md`](docs/architecture.md), [`docs/specs/`](docs/specs/README.md),
> and [`docs/decisions/`](docs/decisions/README.md) (ADRs), with
> [`AGENTS.md`](AGENTS.md) as the agent primer. **Still valid here:** the safety
> constraints, code/commit conventions, and environment-variable list.
> **Superseded here:** the Cowork + Claude-in-Chrome runtime and three-layer
> *browser-first data gathering* model (now MCP/plugin-first per
> [ADR-0004](docs/decisions/adr-0004-mcp-plugin-first-source-integration.md)); the
> Slack DM-to-self / `stage-slack-draft.js` draft path (now native Slack drafts per
> [ADR-0005](docs/decisions/adr-0005-slack-plugin-native-drafts.md)); and the
> Phase 0–8 plan (replaced by the jig spec lifecycle). See
> [`docs/architecture.md` § Legacy documentation](docs/architecture.md#legacy-documentation)
> for the full disposition. Kept as reference; a port of the still-valid parts is deferred.

This is the project bible. Read this file AND `docs/morning-assistant-v2-vision.md` before writing any code or skills. Follow these conventions strictly.

---

## What This Project Does

A personal productivity agent with two modes:

**Mode 1 — Morning Brief**: Runs on schedule (or manually). Gathers context from Slack, Outlook, JIRA, Confluence, and GitHub via APIs/connectors. Writes a structured daily note to the Obsidian vault. Then uses Claude in Chrome to stage draft responses in each tool's compose UI — without sending.

**Mode 2 — Deep Dive**: On-demand. The user asks "What's the latest on Project X?" and the agent searches all tools in parallel, synthesizes a cross-tool timeline, and optionally stages draft follow-ups.

---

## Architecture — The Three Layers

```
Layer 1: ORCHESTRATION — Cowork skills (SKILL.md files)
  Spawns sub-agents, coordinates modes, writes daily note

Layer 2: DATA GATHERING — APIs, connectors, helper scripts (fast)
  Slack connector, GitHub connector, JIRA/Confluence/GitHub Corp REST APIs
  Returns structured JSON to the orchestrator

Layer 3: DRAFT STAGING — Claude in Chrome (slow, targeted)
  Only for composing drafts in tool UIs. Never clicks Send.
```

Browser automation is a last resort for data gathering. Use it only when no API or connector path exists.

---

## Runtime & Tools

- **Orchestration**: Cowork (Claude Desktop) with skills in `~/.claude/skills/`
- **Browser automation**: Claude in Chrome extension
- **Helper scripts**: Node.js 20+, ESM modules (`"type": "module"`)
- **No TypeScript** — plain JS with JSDoc where helpful
- **No build step** — scripts run directly with `node scripts/fetch-jira.js`
- **No transpilation** — native ESM, top-level await is fine

---

## Project Structure

```
morning-brief-agent/
├── CLAUDE.md                          # This file — project bible
├── docs/
│   └── morning-assistant-v2-vision.md # Full architecture & phase plan
│
├── skills/                            # Cowork skills (copied to ~/.claude/skills/)
│   ├── morning-assistant/
│   │   ├── SKILL.md                   # Orchestrator — both modes
│   │   ├── config/
│   │   │   ├── config.example.json    # Template (committed)
│   │   │   └── config.json            # User's actual config (gitignored)
│   │   └── state/
│   │       ├── wiki-state.json        # Confluence version tracking (gitignored)
│   │       └── last-run.json          # Last execution timestamp (gitignored)
│   │
│   ├── morning-slack/
│   │   ├── SKILL.md
│   │   └── config/
│   │       ├── slack-sections.example.json
│   │       └── slack-sections.json    # gitignored
│   │
│   ├── morning-outlook/
│   │   ├── SKILL.md
│   │   └── config/
│   │       ├── outlook-rules.example.json
│   │       └── outlook-rules.json     # gitignored
│   │
│   ├── morning-jira/
│   │   ├── SKILL.md
│   │   └── config/
│   │       ├── jira-filters.example.json
│   │       └── jira-filters.json      # gitignored
│   │
│   ├── morning-confluence/
│   │   ├── SKILL.md
│   │   └── config/
│   │       ├── confluence-spaces.example.json
│   │       └── confluence-spaces.json # gitignored
│   │
│   ├── morning-github/
│   │   ├── SKILL.md
│   │   └── config/
│   │       ├── github-repos.example.json
│   │       └── github-repos.json      # gitignored
│   │
│   ├── morning-ai-radar/
│   │   ├── SKILL.md
│   │   └── config/
│   │       ├── ai-radar.example.json
│   │       └── ai-radar.json          # gitignored
│   │
│   └── morning-spike/
│       └── SKILL.md                   # Phase 0 validation tests
│
├── scripts/                           # Helper scripts for API-based data gathering
│   ├── fetch-jira.js                  # JIRA DC REST API → JSON
│   ├── fetch-confluence.js            # Confluence DC REST API → JSON
│   ├── fetch-github-corp.js           # Corporate GitHub API → JSON
│   ├── fetch-github-com.js            # GitHub.com API → JSON (fallback)
│   ├── fetch-slack.js                 # Slack API → JSON (fallback if connector unavailable)
│   ├── fetch-ai-radar.js             # RSS/GitHub/HTML watch → Claude triage → JSON
│   ├── lib/
│   │   ├── atlassianFetch.js          # Shared JIRA/Confluence auth + fetch util
│   │   └── config.js                  # Config loader utility
│   └── .env.example                   # API tokens template (committed)
│
├── specs/                             # v1 specs — reference for helper script logic
│   ├── 04-slack.md
│   ├── 06-jira.md
│   ├── 07-confluence.md
│   ├── 08-github.md
│   └── 09-ai-radar.md
│
└── .gitignore
```

---

## Code Conventions

### Scripts (Layer 2)

- Always `async/await`, never `.then()` chains or callbacks
- Every script accepts a mode flag: `--brief` (lookback scan) or `--search "query terms"`
- Every script outputs structured JSON to stdout — nothing else to stdout
- Errors go to stderr via `console.error('[module]', ...)`
- Progress/debug goes to stderr via `console.error('[module]', ...)`
- JSON output to stdout must be parseable by the Cowork sub-agent that invokes the script
- Use Node.js built-in `fetch` — no axios, no node-fetch, no HTTP client libraries
- Use `process.env` via dotenv for secrets — never hardcode tokens
- Each script must be independently fault-tolerant and runnable standalone for debugging:
  ```bash
  node scripts/fetch-jira.js --brief
  node scripts/fetch-jira.js --search "auth migration"
  ```

### Script Output Format

Every script returns the same envelope:

```json
{
  "ok": true,
  "tool": "jira",
  "mode": "brief",
  "timestamp": "2026-03-17T08:00:00Z",
  "data": { ... },
  "errors": []
}
```

On failure:
```json
{
  "ok": false,
  "tool": "jira",
  "mode": "brief",
  "timestamp": "2026-03-17T08:00:00Z",
  "data": null,
  "errors": ["JIRA_BASE_URL not set", "Connection refused"]
}
```

### Skills (Layer 1)

- SKILL.md files are natural language instructions — not code
- They describe WHAT to do, not HOW to implement it
- They reference config files for user-specific settings
- They reference helper scripts for data gathering
- They include safety constraints inline (never send, never delete, etc.)
- They follow the Agent Skills open standard (compatible with `gh-upskill`)

### Error Handling — Critical Rule

Every tool must fail independently. If JIRA is down, the brief still runs with a note: "JIRA: unavailable — connection refused." Never let one tool's failure crash the orchestrator or block other tools.

### Config File Pattern

Config lives in `{skill}/config/{tool}.json`. Example files (`.example.json`) are committed. Actual config files are gitignored. Every script/skill that uses config must:
- Fail clearly if the config file is missing (don't silently use wrong defaults)
- Validate required fields before making API calls
- Support a `lookback_hours_override` that overrides the global default

### No Over-Engineering

This is a personal tool. Prefer:
- Simple over clever
- One file over many abstractions
- `console.error` over logging frameworks
- Flat config over deeply nested
- Working today over perfect tomorrow

---

## Commit Conventions

[Conventional Commits](https://www.conventionalcommits.org/) enforced by commitlint + husky.

### Format
```
<type>(<scope>): <description>

[optional body]

[optional footer — list TODOs here]
```

### Types
| Type | When to use |
|---|---|
| `feat` | New script, skill, or feature |
| `fix` | Bug fix |
| `chore` | Dependency updates, config changes, tooling |
| `docs` | README, specs, CLAUDE.md, vision doc updates |
| `skill` | New or updated SKILL.md file |
| `refactor` | Code restructuring with no behaviour change |

### Scopes (optional but encouraged)
`orchestrator`, `slack`, `outlook`, `jira`, `confluence`, `github`, `ai-radar`, `scripts`, `config`

### Setup
```bash
npm install --save-dev @commitlint/cli @commitlint/config-conventional husky
npx husky init
echo "npx --no -- commitlint --edit \$1" > .husky/commit-msg
```

---

## Per-Tool Access Strategy

| Tool | Gather (Layer 2) | Draft (Layer 3) | Config |
|---|---|---|---|
| Slack | Connector or `fetch-slack.js` | DM-to-self via `stage-slack-draft.js` (API, zero send risk) | `slack-sections.json` |
| Outlook | M365 connector or browser fallback | Claude in Chrome (auto-saves to Drafts) | `outlook-rules.json` |
| JIRA DC | `fetch-jira.js` (REST API) | Local MD fragment — no browser drafting (no draft persistence) | `jira-filters.json` |
| Confluence DC | `fetch-confluence.js` (REST API) | None (read-only) | `confluence-spaces.json` |
| GitHub.com | GitHub connector or `fetch-github-com.js` | Local MD fragment — PR reviews only via browser (issue comments don't persist) | `github-repos.json` |
| GitHub Corp | `fetch-github-corp.js` (REST API) | Local MD fragment — PR reviews only via browser (issue comments don't persist) | `github-repos.json` |
| AI Radar | `fetch-ai-radar.js` (RSS + GitHub API) | None (read-only) | `ai-radar.json` |

When a connector is available and working, prefer it over the script. The script is the fallback.

**Draft delivery rule (see ADR-002):** Slack uses DM-to-self via API (`stage-slack-draft.js`) — zero send risk, already formatted in mrkdwn. JIRA and GitHub issue comments write local Markdown fragments to `{vault}/drafts/YYYY-MM-DD-{tool}-{id}-comment.md` and surface them in the daily note. GitHub PR reviews use GitHub's native "pending review" feature via API. Outlook uses browser compose (auto-saves to Drafts). All drafts are surfaced in the daily note's Staged Drafts table.

---

## Safety Constraints — NON-NEGOTIABLE

These rules apply to all skills and scripts. They are not suggestions.

1. **NEVER send messages** — compose drafts, never click Send/Submit/Post
2. **NEVER delete emails** — archive is OK, permanent deletion requires human action
3. **NEVER modify wiki pages** — Confluence is strictly read-only
4. **NEVER merge PRs or push code** — read and stage review comments only
5. **NEVER change JIRA ticket status** — read, search, stage comments only
6. **Graceful stop on error** — login prompts, CAPTCHAs, error pages → stop, log, skip to next tool
7. **Transparent reporting** — every action/skip is recorded in the daily note
8. **Deep Dive scope control** — search only configured/enabled tools. Never explore beyond config.

---

## Environment Variables (for helper scripts)

```bash
# JIRA DC
JIRA_BASE_URL=https://jira.yourcompany.com
JIRA_USER=your@email.com
JIRA_API_TOKEN=

# Confluence DC
CONFLUENCE_BASE_URL=https://confluence.yourcompany.com
CONFLUENCE_USER=your@email.com
CONFLUENCE_API_TOKEN=

# GitHub.com
GITHUB_COM_TOKEN=

# Corporate GitHub
GITHUB_CORP_BASE_URL=https://github.yourcompany.com/api/v3
GITHUB_CORP_TOKEN=

# Behaviour
LOOKBACK_HOURS=24
```

---

## Reference Specs (v1)

The `specs/` folder contains v1 API specs. Use them as the reference for building helper scripts:

| Spec | Feeds into |
|---|---|
| `specs/06-jira.md` | `scripts/fetch-jira.js` — JQL queries, response parsing, error handling |
| `specs/07-confluence.md` | `scripts/fetch-confluence.js` — CQL queries, wiki-state diffing, space config |
| `specs/08-github.md` | `scripts/fetch-github-*.js` — dual-instance Octokit, notification enrichment |
| `specs/04-slack.md` | `scripts/fetch-slack.js` — section config, emoji triage, channel grouping |
| `specs/09-ai-radar.md` | `scripts/fetch-ai-radar.js` — RSS feeds, GitHub releases/commits, HTML page watches, Claude triage |

---

## Phase Plan (Summary)

See `docs/morning-assistant-v2-vision.md` for the full plan.

| Phase | Goal | Key deliverables |
|---|---|---|
| **0** | Validation spike | Confirm API access, browser draft staging, sub-agent spawning, file write |
| **1** | Read-only brief | Orchestrator skill, helper scripts, daily note to Obsidian (no drafts) |
| **2** | Slack | Full read + search + draft staging |
| **3** | Outlook/Teams | Full read + search + draft staging (unblocks MS Graph dependency) |
| **4** | JIRA DC | Full read + search + draft staging |
| **5** | Confluence DC | Read + search (read-only, no drafts) |
| **6** | GitHub | Full read + search + draft staging (both instances) |
| **7** | AI Radar | RSS/trending fetch, Claude triage, daily note section |
| **8** | Polish | Performance tuning, Deep Dive improvements, connector upgrades |

**Start each Claude Code session with**: "Read CLAUDE.md and docs/morning-assistant-v2-vision.md before doing anything."

---

## What Claude Code Should NOT Do

- Do not add TypeScript
- Do not add a web server or API layer
- Do not add a database
- Do not use `require()` — ESM only
- Do not install lodash, axios, or utility libraries (Node built-in `fetch` is sufficient)
- Do not create React or frontend code
- Do not abstract things "for future flexibility" — build what the spec says
- Do not write browser automation code in scripts — browser interaction is handled by Claude in Chrome via skills, not by Puppeteer/Playwright in Node.js
- Do not attempt to send, submit, or post any messages — drafts only
- Do not modify SKILL.md files to bypass safety constraints
