---
status: DRAFT
dependencies: []
last_verified:
---

## Slice 009-02 — jira-inprogress-staleness

**Goal:** Surface the user's JIRA tickets stuck in an in-progress state with no
recent update, in the daily brief — the tickets today's lookback-bounded scan
filters out precisely because they haven't moved.

**DoR:**
- [ ] `fetch-jira.js` auth + project config is available.
- [ ] Confirmed: `assignee = currentUser() AND statusCategory = "In Progress"`
      returns in-progress tickets without a lookback bound (Assumption A2).

**Acceptance Criteria:**

1. **In-progress assigned tickets are detected without a lookback bound.**
   A dedicated query returns tickets where `assignee = currentUser()` and
   `statusCategory = "In Progress"` across configured projects, ordered oldest-
   update-first — independent of the brief's `-Nh` window. Each carries key,
   summary, status (the concrete name, e.g. "In Review"), priority, URL, and
   last-update timestamp.
2. **Staleness is computed in business days and classified.** Each ticket is
   tagged `fresh`, `🟡 stale` (≥ 3 business days no update), or `🔴 very-stale`
   (≥ 5 business days), using configurable thresholds (defaults 3 / 5).
   Weekends are excluded from the age count.
3. **The daily brief shows only the stale ones.** The Open Work section lists
   `🟡`/`🔴` tickets only (fresh withheld until 009-03), each with deep link,
   status, and age (e.g. "no update 4 business days"). Omitted when none stale.
4. **No overlap/double-count with the existing JIRA section.** A ticket
   surfaced here as stale is not also duplicated in the recently-updated JIRA
   section (by construction it can't be — stale means outside the lookback —
   but the brief must not list the same key twice if windows ever overlap).
5. **Read-only.** No status transition, comment, or field change.

**DoD:**
- [ ] All ACs pass; full test suite green on Node 20 (no regressions).
- [ ] Business-day staleness has unit coverage: a ticket last updated Friday
      read on Monday is not yet 🔴; boundary cases at 3 and 5 business days;
      an empty result.
- [ ] Reviewed by `reviewer` subagent (compliance + craft).
- [ ] Sample/fixture JSON captured.
- [ ] Deviation log produced under this slice heading.
- [ ] Reconciliation sweep produced under this slice heading.

**Anti-horizontal-phasing check:** After this slice, the daily brief tells the
user "these in-progress tickets of yours have gone quiet for N days" — the
forgotten-ticket case — which the current updated-in-last-24h scan can never
show.

### Deviation log (after reconciliation)

_Not started._
