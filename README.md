# Morning Assistant v2

A personal productivity agent that scans your work tools, produces a structured Daily Brief, and stages draft replies in each tool's web UI — ready for you to review and send with one click.

---

## What it does

**Morning Brief (Push)** — Scheduled or manual. Gathers context from all tools, writes a daily note to your Obsidian vault, then stages draft responses in compose boxes across Slack, Outlook, JIRA, and GitHub.

**Deep Dive (Pull)** — On-demand. Ask "What's the latest on Project X?" and get a cross-tool timeline with optional draft follow-ups.

---

## Architecture — Three Layers

```
Layer 1: ORCHESTRATION — Cowork skills (SKILL.md files)
  Spawns sub-agents, coordinates modes, writes daily note

Layer 2: DATA GATHERING — APIs, connectors, helper scripts (fast)
  Returns structured JSON. Seconds, not minutes.

Layer 3: DRAFT STAGING — Claude in Chrome (slow, targeted)
  Only for composing drafts in tool UIs. Never clicks Send.
```

Browser automation is a last resort for data gathering. Use it only when no API or connector path exists. Draft staging is always browser-based — that's where the value is.

---

## Project structure

```
skills/                    # Cowork skills (copied to ~/.claude/skills/)
├── morning-assistant/     # Orchestrator — both modes, daily note
├── morning-slack/         # Mentions, DMs, priority channels, draft replies
├── morning-outlook/       # Email triage, Teams, draft replies
├── morning-jira/          # Assigned tickets, discussions, draft comments
├── morning-confluence/    # Page changes, mentions (read-only)
├── morning-github/        # PR reviews, notifications, draft review comments
├── morning-ai-radar/      # RSS/trending → Claude triage → daily note section
└── morning-spike/         # Phase 0 validation tests

scripts/                   # Helper scripts for API-based data gathering
├── fetch-jira.js          # JIRA DC REST API → JSON
├── fetch-confluence.js    # Confluence DC REST API → JSON
├── fetch-github-corp.js   # Corporate GitHub API → JSON
├── fetch-github-com.js    # GitHub.com API → JSON (fallback)
├── fetch-slack.js         # Slack API → JSON (fallback)
├── fetch-ai-radar.js      # RSS/GitHub trending → Claude triage → JSON
└── lib/                   # Shared utilities

specs/                     # v1 specs — reference for helper script logic
docs/                      # Vision doc, architecture reference
```

---

## Getting started

### Prerequisites
- **Node.js 20+**
- **Cowork** (Claude Desktop) installed
- **Claude in Chrome** extension installed
- Chrome with your work tools logged in: Slack, Outlook, JIRA, Confluence, GitHub
- An Obsidian vault for daily notes

### Install

```bash
# Clone and install deps
git clone <repo-url> && cd morning-brief-agent
npm install

# Copy skills to Cowork
cp -r skills/* ~/.claude/skills/

# Set up API tokens for helper scripts
cp scripts/.env.example scripts/.env
# Edit scripts/.env with your JIRA/Confluence/GitHub tokens

# Set up config files
cp ~/.claude/skills/morning-assistant/config/config.example.json \
   ~/.claude/skills/morning-assistant/config/config.json
# Edit config.json: vault_path, scripts_path, tool URLs
# Repeat for each tool's config (jira, confluence, github, etc.)
```

### Run

1. Open Chrome with work tools logged in
2. Open Cowork (Claude Desktop)
3. Say: **"Run my morning brief"**

### Test individual scripts

Each helper script is independently runnable:

```bash
node scripts/fetch-jira.js --brief           # Lookback scan
node scripts/fetch-jira.js --search "auth"    # Deep Dive search
```

---

## Safety constraints

Non-negotiable. The agent enforces these without exception:

- **Never sends messages** — drafts only; you click Send
- **Never permanently deletes emails** — archive only
- **Never edits Confluence pages** — read-only
- **Never merges PRs** — read-only on GitHub
- **Never changes JIRA ticket status** — comment drafts only

---

## Phase plan

| Phase | Goal |
|---|---|
| 0 | Validation spike — API access, browser draft staging, sub-agents, file write |
| 1 | Orchestrator + read-only brief (no drafts) |
| 2 | Slack (full: read + search + draft) |
| 3 | Outlook/Teams (full: read + search + draft) |
| 4 | JIRA DC (full: read + search + draft) |
| 5 | Confluence DC (read + search only) |
| 6 | GitHub (full: read + search + draft, both instances) |
| 7 | AI Radar (RSS/trending fetch + triage) |
| 8 | Polish (parallelism, Deep Dive improvements, connector upgrades) |

---

## Further reading

- `CLAUDE.md` — project bible, code conventions, architecture overview
- `docs/morning-assistant-v2-vision.md` — full vision, phase plan, design decisions
- `specs/` — v1 API specs (reference for helper scripts)
