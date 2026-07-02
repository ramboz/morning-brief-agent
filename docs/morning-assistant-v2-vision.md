# Morning Assistant v2 — Vision & Reference Plan

> **⚠️ Legacy vision doc (annotated 2026-07-02, spec 008-03).** Superseded as the
> current vision by [`docs/product-vision.md`](product-vision.md) and as the plan
> of record by the jig specs ([`docs/specs/`](specs/README.md)); mechanics live in
> [`docs/architecture.md`](architecture.md). The Cowork + Claude-in-Chrome framing
> below is historical — the project is now MCP/plugin-first per
> [ADR-0004](decisions/adr-0004-mcp-plugin-first-source-integration.md). Retained
> for design rationale. See [`docs/architecture.md` § Legacy documentation](architecture.md#legacy-documentation).

## Executive Summary

The Morning Assistant v2 is a hybrid personal productivity agent combining **fast API/connector-based data gathering** with **targeted browser automation for draft staging**. It runs on **Cowork + Claude in Chrome**, orchestrated through skills and lightweight scripts.

Implementation should proceed as a series of **thin vertical slices**, not broad platform work. Each slice should earn its place by producing real fetch, useful triage, Obsidian-ready Markdown, and a reproducible fixture.

The key insight: browser automation is only essential for tools with **native draft persistence** (Slack compose box, Outlook Drafts folder, GitHub pending reviews). For tools without draft persistence (JIRA, GitHub issue comments), drafts are written as local Markdown fragments to the Obsidian vault instead. Everything else (reading messages, searching tickets, fetching notifications) is faster and more reliable via APIs and connectors. See [ADR-001](decisions/adr-0001-draft-staging-mechanism.md).

### Two Modes of Operation

**Mode 1 — Morning Brief ("Push")**: Scheduled or manually triggered each morning. Gathers context from all tools via APIs/connectors, produces a structured daily note ("Daily Presidential Brief"), then uses browser automation to stage draft responses in the specific threads/tickets/emails that need replies.

**Mode 2 — Deep Dive ("Pull")**: On-demand, conversational. The user asks "What's the latest on Project ABC?" — the agent searches across all tools via APIs/connectors, synthesizes a cross-tool answer, and optionally stages follow-up drafts via browser.

### Architecture evolution: v1 → v2

| Aspect | v1 (CLI) | v2 (Hybrid) |
|---|---|---|
| Data gathering | REST APIs via Node.js | APIs + connectors via Cowork skills + scripts |
| Draft staging | N/A (dead end) | Browser automation via Claude in Chrome |
| Authentication | Per-service API tokens | API tokens for data; browser sessions for drafts |
| Output — brief | Static Obsidian daily note | Daily brief **plus** staged drafts in each tool |
| Output — query | N/A | On-demand cross-tool synthesis + optional drafts |
| Parallelism | `Promise.allSettled` | Cowork sub-agents |
| Runtime | Node.js + Windows Task Scheduler | Cowork + Claude in Chrome + helper scripts |
| MS Graph dependency | Blocked on IT admin approval | Browser path unblocks Outlook; API path available when approved |

---

## Hybrid Architecture

### The Three Layers

```
┌─────────────────────────────────────────────────────────┐
│ Layer 1: ORCHESTRATION (Cowork Skills)                  │
│                                                         │
│  morning-assistant/SKILL.md                             │
│  ├── Spawns sub-agents (one per tool)                   │
│  ├── Collects results, synthesizes action items          │
│  ├── Writes daily note to Obsidian vault                │
│  └── Triggers browser layer for draft staging           │
│                                                         │
│  Modes: Morning Brief (scheduled) | Deep Dive (ad-hoc)  │
└──────────────────────────┬──────────────────────────────┘
                           │
              ┌────────────┴────────────┐
              ▼                         ▼
┌──────────────────────────┐  ┌──────────────────────────┐
│ Layer 2: DATA GATHERING  │  │ Layer 3: DRAFT STAGING   │
│ (APIs + Connectors)      │  │ (Browser Automation)     │
│                          │  │                          │
│ FAST — seconds           │  │ SLOW — only when needed  │
│                          │  │                          │
│ • Slack connector/API    │  │ • Navigate to thread     │
│ • GitHub connector/API   │  │ • Type in compose box    │
│ • JIRA DC REST API       │  │ • Do NOT click Send      │
│ • Confluence DC REST API │  │                          │
│ • Outlook connector*     │  │ Targets only the ~5-10   │
│   or browser fallback    │  │ items needing a reply    │
│                          │  │                          │
│ Returns structured data  │  │ Uses Claude in Chrome    │
│ to orchestrator          │  │ extension                │
└──────────────────────────┘  └──────────────────────────┘

* Outlook: connector if available, browser if not (Graph API when approved)
```

### Per-Tool Access Strategy

| Tool | Data Gathering (Layer 2) | Draft Staging (Layer 3) | Notes |
|---|---|---|---|
| **Slack** | Cowork connector or Slack API via script | Claude in Chrome | Connector for read/search; browser for compose box |
| **Outlook** | Cowork M365 connector, or browser fallback | Claude in Chrome | Connector preferred; browser unblocks while Graph approval pending |
| **Teams** | Cowork M365 connector, or browser fallback | N/A (read-only for now) | Surface mentions/activity; draft staging deferred |
| **JIRA DC** | REST API via helper script | **Local MD fragment** (no browser — JIRA has no draft persistence) | Self-hosted — no connector. v1 spec (`specs/06-jira.md`) defines the API calls |
| **Confluence DC** | REST API via helper script | N/A (read-only) | Self-hosted — no connector. v1 spec (`specs/07-confluence.md`) defines the API calls |
| **GitHub.com** | Cowork GitHub connector or API via script | Claude in Chrome (PR reviews only — pending review persists); **Local MD fragment** for issue comments | Connector for notifications/PRs; browser for PR review compose box only |
| **GitHub Corp** | REST API via helper script | Claude in Chrome | Self-hosted — no connector. v1 spec (`specs/08-github.md`) defines the API calls |

### Speed Profile

| Phase | Method | Expected Time |
|---|---|---|
| Data gathering (all 6 tools, parallel) | APIs + connectors via sub-agents | 30–60 seconds |
| Summarization + cross-tool synthesis | Claude (within Cowork) | 5–15 seconds |
| Daily note write | Cowork filesystem access | Instant |
| Draft staging (~5-10 items) | Claude in Chrome, sequential | 2–4 minutes |
| **Total Morning Brief** | | **~3-5 minutes** |
| **Deep Dive query** (no drafts) | APIs + synthesis | **~30-60 seconds** |

---

## Why This Hybrid (Not Pure Browser, Not Pure CLI)

### What we tried and learned

| Approach | Strength | Weakness |
|---|---|---|
| **v1 Pure CLI** | Fast, reliable APIs | Can't stage drafts in tools. Dead end for the "morning workstation" UX. |
| **Pure browser (SLICC/Cowork)** | Can do everything including draft staging | 10-15 min for a full brief. Fragile with custom editors. Overkill for read operations. |
| **Hybrid** | API speed for reads + browser precision for drafts | Slightly more complexity to maintain two access paths per tool. |

The hybrid costs some additional architecture complexity but delivers an order-of-magnitude speed improvement over pure browser automation while preserving the draft-staging UX that makes v2 transformative.

### Where v1 work is directly reused

The v1 specs are not abandoned — they're the fast path:

- **`specs/06-jira.md`** → JIRA DC REST API calls for the data-gathering helper script
- **`specs/07-confluence.md`** → Confluence DC REST API calls + wiki-state.json diffing pattern
- **`specs/08-github.md`** → Corporate GitHub API calls (Octokit config, dual-instance handling)
- **`specs/04-slack.md`** → Slack sections config, channel groupings, emoji triage signals
- **Summarization prompts** → Claude API prompting strategy (concise, 🔴/ℹ️ flags, max 5 bullets)
- **Triage classification** → Email categories (action_required, fyi, newsletter, automated_alert, junk)
- **Config patterns** → `config/` folder per skill, example files committed, actuals gitignored

---

## Component Design

### Helper Scripts

For tools without connector support (JIRA DC, Confluence DC, Corporate GitHub), lightweight Node.js scripts handle API calls. These are the v1 source modules, simplified — they fetch data and return JSON, nothing more.

```
scripts/
├── fetch-jira.js          # JIRA DC REST API → JSON
├── fetch-confluence.js    # Confluence DC REST API → JSON
├── fetch-github-corp.js   # Corporate GitHub API → JSON
├── fetch-github-com.js    # GitHub.com API → JSON (fallback if connector unavailable)
├── fetch-slack.js         # Slack API → JSON (fallback if connector unavailable)
├── fetch-ai-radar.js      # RSS/GitHub/HTML watch → Claude triage → JSON
└── .env                   # API tokens (gitignored)
```

Each script:
- Takes a mode argument: `--brief` (lookback scan) or `--search "query"` (deep dive)
- Returns structured JSON to stdout
- Is runnable standalone for debugging: `node scripts/fetch-jira.js --brief`
- Follows the v1 pattern: ESM, no frameworks, Node.js built-in `fetch`

The Cowork sub-agent invokes the script via shell, parses the JSON output, and proceeds to summarization and (optionally) browser-based draft staging.

### Skills Directory

```
~/.claude/skills/
├── morning-assistant/
│   ├── SKILL.md                    # Orchestrator — both modes
│   ├── config/
│   │   ├── config.example.json     # Template (shareable)
│   │   └── config.json             # User's actual config
│   └── state/
│       ├── wiki-state.json         # Confluence version tracking
│       └── last-run.json           # Last execution timestamp
│
├── morning-slack/
│   ├── SKILL.md                    # Slack sub-agent instructions
│   └── config/
│       └── slack-sections.json     # Priority channel groupings
│
├── morning-outlook/
│   ├── SKILL.md                    # Outlook/Teams sub-agent instructions
│   └── config/
│       └── outlook-rules.json      # Triage rules, auto-archive patterns
│
├── morning-jira/
│   ├── SKILL.md                    # JIRA sub-agent instructions
│   └── config/
│       └── jira-filters.json       # Boards, projects, JQL filters
│
├── morning-confluence/
│   ├── SKILL.md                    # Confluence sub-agent instructions
│   └── config/
│       └── confluence-spaces.json  # Watched spaces and pages
│
├── morning-github/
│   ├── SKILL.md                    # GitHub sub-agent instructions
│   └── config/
│       └── github-repos.json       # Repos, PR review config
│
└── morning-ai-radar/
    ├── SKILL.md                    # AI Radar sub-agent instructions
    └── config/
        └── ai-radar.json           # Feed URLs, triage config
```

### Skill Anatomy — How a Sub-Agent Works

Each tool skill follows the same three-step pattern:

```
Step 1: GATHER (fast)
  → Use connector, or invoke helper script, or use Cowork API access
  → Return structured data (messages, tickets, notifications, etc.)
  → Time: seconds

Step 2: ANALYZE (fast)
  → Claude summarizes, prioritizes, identifies items needing a reply
  → Apply tool-specific logic (triage rules, emoji signals, relevance filters)
  → Return: summary sections + list of draft targets
  → Time: seconds

Step 3: DRAFT (slow, targeted)
  → For each draft target: open Claude in Chrome, navigate to the specific
    thread/ticket/email, type the draft in the compose box, stop
  → Only triggered for items where draft_enabled=true and a reply is warranted
  → Time: 15-30 seconds per draft
```

---

## Core Concepts

### Mode 1 — Morning Brief ("Push")

1. **Orchestrator triggers** (Cowork scheduled task or manual "run my morning brief")
2. **Parallel data gathering**: Sub-agents fetch from all tools simultaneously via APIs/connectors
3. **Per-tool analysis**: Each sub-agent summarizes its data, identifies draft targets
4. **Cross-tool synthesis**: Orchestrator merges results, produces unified Action Items
5. **Daily note write**: Structured markdown written to Obsidian vault
6. **Draft staging**: Orchestrator (or sub-agents) use Claude in Chrome to stage drafts in each tool's UI — sequentially, only for items needing replies
7. **Done**: User reads brief, walks through staged drafts, reviews and sends

### Mode 2 — Deep Dive ("Pull")

The user asks a question in Cowork at any time:

> "What's the latest on Project Helios?"
> "Catch me up on ENG-482 — Slack, JIRA, GitHub, everything."
> "What has Alice been working on this week?"

1. **Query parsing**: Extract search terms, time range, relevant tools
2. **Parallel search**: Sub-agents search their tools via APIs/connectors (fast)
3. **Cross-tool synthesis**: Deduplicate, build timeline, identify key decisions and open items
4. **Present conversationally**: Show results in Cowork, organized by timeline or topic
5. **Optional draft staging**: "Want me to draft responses for any of these?" — if yes, use Claude in Chrome for the specific items

### How the two modes complement each other

- **Morning Brief** eliminates: "45 minutes checking all my tools to figure out what needs attention."
- **Deep Dive** eliminates: "30 minutes searching across Slack, JIRA, Confluence, and email to get the full picture on one topic."

---

## Phase Plan

### Phase 0 — Validation Spike

**Goal**: Confirm all access paths work against the user's actual tool instances.

**API/Connector validation** (should be fast to verify):
1. Slack connector or API returns channel messages
2. GitHub connector or API returns notifications
3. JIRA DC REST API responds with ticket data (reuse v1 auth approach)
4. Confluence DC REST API responds with page data
5. Outlook: test M365 connector availability; if unavailable, test browser fallback

**Browser validation** (the critical tests):
6. Claude in Chrome can type into Slack's compose box without sending
7. Claude in Chrome can type into Outlook's reply compose without sending
8. Claude in Chrome can type into JIRA's comment box without submitting
9. Sub-agent spawning: Cowork can spawn ≥2 sub-agents that each execute independently

**Infrastructure validation**:
10. Cowork can write a file to the Obsidian vault path
11. Cowork can invoke a Node.js helper script and read its stdout
12. A scheduled Cowork task triggers reliably with Chrome extension active

**Pass criteria**: All API/connector tests pass. At least Slack + one other tool pass browser draft staging. Sub-agents work (even if sequential). File write works.

### Phase 1 — Orchestrator + Read-Only Brief

**Goal**: Working morning brief that gathers data from all tools and writes the daily note. No drafting yet.

**Deliverables**:
- `morning-assistant/SKILL.md` — orchestrator skill for both modes
- Helper scripts for JIRA DC, Confluence DC, Corporate GitHub
- Global config file
- Daily note output to Obsidian vault

### Phase 2 — Slack (Full: Read + Search + Draft)

**Goal**: Complete Slack workflow across both modes.

**Gather** (connector or API):
- Unread channels, threads with mentions, DMs
- Priority channels from `slack-sections.json`
- Emoji triage signals: `:eyes:`, `:bookmark:`, `:pushpin:`

**Search** (Deep Dive mode):
- Slack search with query terms, filtered by channel/date/sender

**Draft** (Claude in Chrome):
- Navigate to threads needing replies, compose in message input, stop before sending

**Daily note section**:
```markdown
## 💬 Slack

### 🔴 Mentions & Threads
- 🔴 **#eng-general** — Alice asked for review on deployment plan *(2h ago)* → [Draft staged]
- 🔴 **#incidents** — Tagged in P1 post-mortem thread *(5h ago)* → [Draft staged]

### Direct Messages
- **Bob Smith** — Wants to sync about Q2 planning. → [Draft staged]

### Engineering
#### #eng-general
- Deployed v2.4.1 to production ✅
- Discussion on Postgres 16 migration — no decision yet

### Staged Drafts (3)
1. #eng-general → Reply to Alice re: deployment plan review
2. #incidents → P1 post-mortem acknowledgment
3. DM Bob Smith → Confirm sync meeting
```

### Phase 3 — Outlook / Teams (Full: Read + Search + Draft)

**Goal**: Email scanning, triage, search, and draft staging.

**Critical unlock**: Browser automation eliminates the Microsoft Graph admin approval dependency for draft staging. If the M365 connector is available, data gathering is also fast. If not, browser reads as fallback until Graph API is approved.

**Gather** (connector or browser fallback):
- Inbox emails within lookback window (sender, subject, preview)
- Teams activity feed (mentions, replies)

**Triage** (Morning Brief only):

| Classification | Action | Draft? |
|---|---|---|
| `action_required` | Keep in inbox | Yes |
| `fyi` | Keep in inbox | No |
| `newsletter` | Archive | No |
| `automated_alert` | Archive | No |
| `junk` | Flag for deletion (never auto-delete) | No |

**Draft** (Claude in Chrome):
- Open email, click Reply, compose draft, leave without sending

**Daily note section**:
```markdown
## 📬 Email

### Action Required
- 🔴 **VP Engineering** — Q2 budget review, due Friday → [Draft staged]
- 🔴 **Alice Chen** — PR #482 merge conflict → [Draft staged]

### FYI / Reading
- ℹ️ **Platform Team** — New CI/CD pipeline docs
- ℹ️ **HR** — Updated remote work policy, effective April 1

### Auto-Archived (12)
- 8 build alerts, 3 newsletters, 1 calendar update

### 💬 Teams Activity
- **#architecture-council** — Mentioned in API versioning discussion

### Staged Drafts (2)
1. Reply to VP Engineering → Budget review acknowledgment
2. Reply to Alice Chen → Merge conflict resolution
```

### Phase 4 — JIRA DC (Full: Read + Search + Draft)

**Goal**: Ticket scanning, search, and comment draft staging.

**Gather** (REST API via helper script):
- Assigned tickets with recent activity (comments, status changes)
- Tickets where user is mentioned or expected to respond

**Search** (Deep Dive — JQL via script):
- Filter by project, assignee, status, keyword, date range

**Draft** (Claude in Chrome):
- Navigate to ticket, compose in comment box, do not submit

**Daily note section**:
```markdown
## 🎫 JIRA

### Updated Tickets
- **ENG-482** — In Review → QA. 2 new comments (Alice, Bob)
- **ENG-501** — New subtask: "Add retry logic" (Carol)
- **PLAT-89** — Blocked: waiting on DevOps

### Discussions to Join
- 🔴 **ENG-482** — Alice asked for caching opinion → [Draft staged]
- 🔴 **PLAT-89** — Flagged for unblock decision → [Draft staged]

### Staged Drafts (2)
1. ENG-482 → Caching approach recommendation
2. PLAT-89 → Unblock decision
```

### Phase 5 — Confluence DC (Read + Search Only)

**Goal**: Wiki change tracking and search. Read-only — no draft staging.

**Gather** (REST API via helper script):
- Recently updated pages in configured spaces
- Incremental diffing via `wiki-state.json`

**Search** (Deep Dive — CQL via script):
- Filter by space, author, date, content keyword

**Daily note section**:
```markdown
## 📖 Confluence

### Recent Changes
- **ADR-047**: "Event Sourcing for Audit Trail" — new, by Carol *(yesterday)*
- **Q2 Roadmap** — Updated: Mobile → Q3, added API v2 milestone
- **Deployment Checklist** — Added rollback step for DB migrations
```

### Phase 6 — GitHub (Full: Read + Search + Draft)

**Goal**: Notification scanning and search across both instances, PR review draft staging.

**Gather** (connector or API via helper script):
- github.com notifications (connector if available, script if not)
- Corporate GitHub notifications (script — self-hosted)
- PR review requests: fetch diff summary and conversation

**Search** (Deep Dive):
- PRs, issues, commits by keyword, repo, author
- Cross-reference JIRA ticket keys in branch names/PR titles

**Draft** (Claude in Chrome):
- PR reviews: compose in review box, do not submit
- Issue comments: compose, leave in input box

**Daily note section**:
```markdown
## 💻 GitHub

### github.com
- 🔴 **PR #482** (repo-name) — Review requested: "Add retry logic" → [Draft staged]
- **Issue #201** — External contributor comment on API docs

### Corporate GitHub
- 🔴 **PR #89** (internal-repo) — Review requested: "Update auth middleware" → [Draft staged]
- **CI** — 2 failed builds on main (repo-x, repo-y)

### Staged Drafts (2)
1. PR #482 → Approve with minor suggestion
2. PR #89 → Request changes on token handling
```

### Phase 7 — AI Radar

**Goal**: First content vertical slice. Nightly curated-source fetch, Claude-powered triage, daily note section, reproducible fixture.

**Gather** (`scripts/fetch-ai-radar.js`):
- RSS/Atom feeds from a small curated set of model/tooling/practitioner sources
- GitHub releases for MCP-related repos
- Optional GitHub trending if it proves high-signal in practice
- Keep the initial source list intentionally small

**Triage** (Claude API call within script):
- Classify each item: today_signal / skills_tutorials / strategic_radar / skip
- Score relevance against `relevance_context` and `project_keywords`
- Flag items with direct project relevance (📌)
- Generate an explicit action/decision layer for the daily read

**Daily note section**:
```markdown
## 🤖 AI Radar

### What Should I Do?
- Evaluate the MCP release notes for changes that matter to your architecture.
- Save the most relevant tutorial or post for this week's implementation time.

### Today's Signal
- 📌 **Anthropic releases Claude 4 with extended thinking** — Directly relevant: evaluate for summarization upgrade.
  [→ Read](https://anthropic.com/...)
- **MCP Specification v1.3 released** — New streamable_http transport.
  [→ Read](https://github.com/...)

### Skills & Tutorials
- 📌 **Building a multi-agent Morning Brief with Cowork** — Matches your exact architecture.
  [→ Read](https://...)

### On Your Radar *(Mondays only)*
- **Shift toward model-native tool calling** — Growing trend away from framework abstractions.

---
*Sources: 5 checked · 14 items fetched · 6 after triage · Last run: 06:00*
```

### Phase 8 — Polish & Optimization

- Tune sub-agent parallelism based on Phase 0 findings
- Improve Deep Dive query parsing (smarter tool selection, skip irrelevant tools)
- State persistence between Morning Brief runs
- Error handling: per-tool graceful degradation
- Draft queue UX: Obsidian manifest linking to staged drafts
- Swap in connectors where they outperform helper scripts
- Swap in Graph API for Outlook when admin approval arrives

---

## Output Formats

### Daily Presidential Brief

Written to: `{vault_path}/{daily_notes_folder}/{YYYY-MM-DD}.md`

```markdown
# Daily Brief — 2026-03-17

## ⚡ Action Items
1. 🔴 **Reply to VP Engineering** (Email) — Q2 budget, due Friday → [Draft in Outlook]
2. 🔴 **Review PR #482** (GitHub) — Retry logic → [Draft in GitHub]
3. 🔴 **Unblock PLAT-89** (JIRA) — Staging env decision → [Draft in JIRA]
4. 🔴 **Reply to Alice** (Slack) — Deployment review → [Draft in Slack]
5. ℹ️ **Read Q2 Roadmap update** (Confluence) — Mobile → Q3

## 📊 Staged Drafts Summary
| # | Tool | Target | Status |
|---|---|---|---|
| 1 | Outlook | Reply to VP Engineering | Ready for review |
| 2 | GitHub | PR #482 review | Ready for review |
| 3 | JIRA | PLAT-89 comment | Ready for review |
| 4 | Slack | #eng-general reply | Ready for review |
| 5 | Slack | DM Bob Smith | Ready for review |

## 💬 Slack
<!-- Per Phase 2 -->

## 📬 Email
<!-- Per Phase 3 -->

## 🎫 JIRA
<!-- Per Phase 4 -->

## 📖 Confluence
<!-- Per Phase 5 -->

## 💻 GitHub
<!-- Per Phase 6 -->

## 🤖 AI Radar
<!-- Per Phase 7 -->

---
*Generated at 08:00 CET — Lookback: 24h — Duration: 3m 42s*
*Agent: Morning Assistant v2 (Cowork Hybrid)*
```

### Deep Dive

Presented conversationally in Cowork. Saved to vault only on request.

```markdown
## 🔍 Deep Dive: Project Helios

### Timeline (last 7 days)

**Monday Mar 10**
- 📬 Alice emailed initial architecture proposal
- 📖 "Helios Architecture" page created in Confluence (Platform space)

**Tuesday Mar 11**
- 💬 Slack #eng-general: DB choice debate (Postgres vs DynamoDB)
- 🎫 HELIOS-12 "Design data model" → In Progress (Bob)

**Wednesday Mar 12**
- 💬 Bob shared data model draft; Alice raised partition key concern
- 🎫 HELIOS-12: 3 comments on partition strategy
- 💻 PR #201 "Initial schema migration" opened (Bob)

**Thursday Mar 13**
- 💬 Decision: Postgres with JSONB
- 🎫 HELIOS-12 → In Review. HELIOS-13 created: "Implement API layer"
- 📖 Architecture page updated with DB decision

### Key Decisions
- Database: Postgres with JSONB (decided Thu)
- Partition strategy: under discussion (HELIOS-12)

### Open Items Needing Your Input
- 🔴 PR #201 — Review requested (schema migration)
- 🔴 HELIOS-13 — Assigned to you, no estimate set

### Want me to draft responses for any of these?
```

---

## Configuration Reference

### Global Config (`morning-assistant/config/config.json`)

```json
{
  "vault_path": "/path/to/obsidian/vault",
  "daily_notes_folder": "Daily Notes",
  "date_format": "YYYY-MM-DD",
  "lookback_hours": 24,
  "deep_dive_default_days": 7,
  "scripts_path": "/path/to/morning-assistant/scripts",
  "tools": {
    "slack": {
      "enabled": true,
      "gather_method": "connector",
      "gather_fallback": "browser",
      "draft_method": "browser",
      "draft_enabled": true,
      "url": "https://app.slack.com"
    },
    "outlook": {
      "enabled": true,
      "gather_method": "connector",
      "gather_fallback": "browser",
      "draft_method": "browser",
      "draft_enabled": true,
      "auto_archive": true,
      "auto_delete": false,
      "url": "https://outlook.office.com"
    },
    "jira": {
      "enabled": true,
      "gather_method": "script",
      "draft_method": "md_fragment",
      "draft_enabled": true,
      "url": "https://jira.yourcompany.com"
    },
    "confluence": {
      "enabled": true,
      "gather_method": "script",
      "draft_method": "none",
      "draft_enabled": false,
      "url": "https://confluence.yourcompany.com"
    },
    "github_com": {
      "enabled": true,
      "gather_method": "connector",
      "gather_fallback": "script",
      "draft_method": "browser_pr_reviews_md_fragment_issues",
      "draft_enabled": true,
      "url": "https://github.com"
    },
    "github_corp": {
      "enabled": true,
      "gather_method": "script",
      "draft_method": "browser_pr_reviews_md_fragment_issues",
      "draft_enabled": true,
      "url": "https://github.yourcompany.com"
    },
    "ai_radar": {
      "enabled": true,
      "gather_method": "script",
      "draft_method": "none",
      "draft_enabled": false
    }
  }
}
```

### Environment Variables (for helper scripts)

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

# Anthropic (for summarization if called from scripts)
ANTHROPIC_API_KEY=

# Behaviour
LOOKBACK_HOURS=24
```

### Slack Sections Config (`morning-slack/config/slack-sections.json`)

```json
{
  "sections": [
    {
      "name": "Engineering",
      "channels": ["#eng-general", "#architecture", "#incidents", "#deploys"]
    },
    {
      "name": "Product",
      "channels": ["#roadmap", "#product-updates", "#feature-requests"]
    },
    {
      "name": "Company",
      "channels": ["#general", "#announcements"]
    }
  ],
  "emoji_triage": {
    "enabled": true,
    "signals": [":eyes:", ":bookmark:", ":pushpin:"]
  },
  "ignore_bots": true,
  "ignore_automated_messages": true
}
```

---

## Critical Safety Constraints

Non-negotiable:

1. **NEVER send messages**: Compose drafts, never click Send/Submit/Post. Human always sends.
2. **NEVER delete emails permanently**: Archive is OK. Permanent deletion requires human action.
3. **NEVER modify wiki pages**: Confluence is read-only.
4. **NEVER merge PRs or push code**: GitHub is read + review comments only.
5. **NEVER change JIRA ticket status**: Read, search, and comment drafts only.
6. **Graceful stop on error**: Login prompts, CAPTCHAs, error pages → stop current tool, log, continue with next.
7. **Transparent reporting**: Every action/skip recorded in output. Full audit trail.
8. **Deep Dive scope control**: Search only configured/enabled tools. Never explore beyond config.

---

## v1 Spec Reuse Map

| v1 Spec | v2 Usage |
|---|---|
| `specs/06-jira.md` | → `scripts/fetch-jira.js` API calls + `morning-jira/SKILL.md` analysis logic |
| `specs/07-confluence.md` | → `scripts/fetch-confluence.js` API calls + wiki-state.json diffing |
| `specs/08-github.md` | → `scripts/fetch-github-corp.js` + `scripts/fetch-github-com.js` |
| `specs/04-slack.md` | → `morning-slack/config/slack-sections.json` + SKILL.md analysis logic |
| `specs/09-ai-radar.md` | → `scripts/fetch-ai-radar.js` + `morning-ai-radar/SKILL.md` |
| `CLAUDE.md` (summarization) | → Prompting patterns reused in orchestrator SKILL.md |
| `CLAUDE.md` (config patterns) | → `config/` folder pattern preserved per skill |
| `CLAUDE.md` (error handling) | → Per-tool graceful degradation preserved |

---

## Design Decisions Carried Forward

- **Conventional Commits**: commitlint + husky for any repo containing skills/scripts
- **Config pattern**: `config/` per skill, `.example.json` committed, actuals gitignored
- **Lookback window**: Default 24h (brief) / 7d (deep dive), configurable
- **Summarization**: Claude API, concise, 🔴/ℹ️ flags, max 5 bullets per channel
- **Emoji triage**: `:eyes:` / `:bookmark:` / `:pushpin:` as relevance signals
- **Wiki diffing**: `wiki-state.json` tracks versions for incremental change detection
- **Error handling**: Per-tool graceful degradation; failures logged, not fatal

---

## Open Questions

1. **Sub-agent browser concurrency**: Can multiple sub-agents drive Chrome tabs simultaneously? If not, draft staging runs sequentially (still fast — only ~5-10 drafts).

2. **Connector availability**: Which Cowork connectors are actually available and functional for Slack, Outlook/M365, and GitHub? This determines the gather_method per tool.

3. **Rich text editors**: Slack, Outlook, JIRA all have custom editors. Test each during Phase 0 — if one fails, that tool's draft staging is deferred.

4. **Draft persistence per tool**: Does Slack preserve unsent text in compose? Does Outlook keep reply drafts open? Test behavior per tool.

5. **Script invocation from Cowork**: Can a Cowork sub-agent reliably run `node scripts/fetch-jira.js --brief` and parse stdout? Needs Phase 0 validation.

6. **Scheduled task + Chrome**: Does Chrome with Claude extension need to be running before the scheduled task fires? What happens if it's not?

7. **Graph API transition**: When IT admin approval arrives, the Outlook gather_method switches from connector/browser to API via script. Design the script now so it's ready to slot in.

---

## Reference: SLICC

SLICC (`github.com/ai-ecoverse/slicc`) by [colleague, principal scientist] remains a reference:
- Cone/scoop model → inspired our orchestrator/sub-agent design
- Licks (event triggers) → parallel to Cowork scheduled tasks
- Agent Skills standard → same SKILL.md format
- CDP browser automation → same patterns as Claude in Chrome

If Cowork hits limitations, SLICC is the fallback runtime. Skill logic (SKILL.md content) is designed to be portable.
