---
status: DRAFT
skill:
use_cases: []
---

# Spec 009: Open-work radar

## Overview

Track the user's **own in-flight work** so nothing goes stale: open pull
requests they authored (across github.com and corporate GitHub) that aren't
merging, and JIRA tickets assigned to them that are stuck in an in-progress
state.

Today's brief only surfaces **incoming** signals — review requests, mentions,
and tickets/PRs updated within the lookback window. It has no view of the
user's **outbound** work once it stops moving. That is exactly the work that
gets forgotten on a context switch: a PR waiting on feedback, an approved PR
never merged, a ticket left "In Progress" for a week.

The radar computes a **staleness** signal from last-activity age and surfaces
it in the morning brief on two cadences:

- **Every day** — a stale-only "Open Work" alert block: only PRs / tickets
  past the staleness threshold, so the daily brief stays lean. Omitted
  entirely when nothing is stale (section-suppression, like every other tool).
- **Mondays** — a fuller "Open Work Review": the complete inventory of open
  authored PRs + in-progress tickets (fresh and stale), so the week starts
  with the whole picture.

Staleness thresholds (time since last activity, no movement):

| Item | 🟡 stale | 🔴 very stale |
|------|----------|---------------|
| PR (authored, open) | 3 days | 7 days |
| JIRA ticket (assigned, in-progress) | 3 business days | 5 business days |

Thresholds live in config so they can be tuned without code changes.

**Read-only throughout.** The radar never comments, nudges, merges, or
transitions anything — the project safety constraints are unchanged. It only
reports what the user already owns.

## Assumptions

- **A1 — GitHub search returns the user's authored open PRs on both
  instances.** `GET /search/issues?q=is:open+is:pr+author:@me` (per instance,
  scoped to the configured orgs) returns open authored PRs with the fields
  staleness needs — `updated_at`, `draft`, and review/CI state (from the item
  payload or a cheap follow-up). Grounding: `scripts/lib/github.js` already
  issues `/search/issues` calls (~lines 310/321) and models PR metadata, so
  the API + auth path is proven. The specific `author:@me` qualifier behavior
  is a small confirmation folded into 009-01 — not a standalone spike.
- **A2 — JIRA can query in-progress tickets without a lookback bound.**
  `assignee = currentUser() AND statusCategory = "In Progress" ORDER BY
  updated ASC` returns the user's stuck tickets oldest-first. Grounding:
  `fetch-jira.js` already uses `assignee = currentUser()` (brief Q1) and reads
  `status` + `updated`; `statusCategory` is a standard JIRA DC JQL field.
  Querying by `statusCategory` (not a hard-coded status name) covers
  project-specific in-progress statuses such as "In Review".
- **A3 — Surfacing path is the orchestrator brief.** The daily note is
  assembled by the `morning-assistant` orchestrator reading Layer-2 fetch
  output (`write-brief.js` is still ai_radar-only). The radar's brief section
  is surfaced by the orchestrator from the fetch scripts' JSON, consistent
  with how every other tool section works today.

## Decomposition

**Primary axis: Data.** Two independent sources (GitHub PRs, JIRA tickets)
become one vertical slice each, so each source delivers its own end-to-end
"you have stale X" value on its own.

**Secondary axis: Rules / Path.** The third slice extends the daily
stale-only view into the Monday full-inventory view — a cadence rule built on
top of the two source slices.

Spike (S) was considered and rejected: the two API-capability unknowns (A1,
A2) are small confirmations folded into 009-01 / 009-02, not research that
must precede a big build.

## Slices

1. **[009-01 — github-open-pr-staleness](slice-01-github-open-pr-staleness.md)**
   — Detect the user's open authored PRs (both instances), compute staleness,
   surface the stale ones in the daily brief.
2. **[009-02 — jira-inprogress-staleness](slice-02-jira-inprogress-staleness.md)**
   — Detect the user's in-progress assigned tickets (no lookback bound),
   compute staleness, surface the stale ones in the daily brief.
3. **[009-03 — monday-full-inventory](slice-03-monday-full-inventory.md)**
   — On Mondays, expand the daily stale-only alerts into a full open-work
   inventory (fresh + stale, flagged).
