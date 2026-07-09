---
status: DONE
dependencies: []
last_verified: 2026-07-09
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

Original ACs preserved above. Implementation notes:

1. **Mirrored 009-01's shape.** `scripts/lib/jira/staleness.js` (pure
   `businessDaysBetween` + `classifyTicketStaleness` + `extractInProgress`,
   `now`-injectable) + a thin `scripts/list-inprogress.js` runner (envelope
   `tool: "jira_in_progress"`, `data.inProgress[]`). Thresholds from
   `config/main.json` `open_work.jira` (defaults 3/5 business days), documented
   in `main.example.json`; `npm` script `list:inprogress`. Business-day math is
   UTC-normalized (DST/timezone-safe) — Friday→Monday = 1 day (not very-stale),
   boundaries at 3/5 tested. Unknown/unparsable `updated` → very-stale (surfaced).

2. **Accepted scope deviation — shared-module extraction.** `jiraGet`,
   `paginateJql`, `formatIssue`, `stripJiraMarkup`, `extractRecentComments`, and
   `FIELDS` were extracted out of `fetch-jira.js` into a new side-effect-free
   `scripts/lib/jira/query.js` (which also hosts the new `runInProgress` /
   `buildInProgressJql`). Reason: importing `fetch-jira.js` fires its `main()` at
   module load, corrupting a consumer's stdout — so the runner imports the lib,
   mirroring `list-open-prs.js` → `lib/github.js`. `fetch-jira.js` now imports
   these; behavior of its brief/search/jql/context modes is preserved. The arch
   pass confirmed this is the correct boundary. **No ADR** was written: this is a
   precedent-following mechanical refactor (no product/behavioral trade-off),
   satisfying architecture.md's "shared abstractions only after repeated concrete
   need" and CLAUDE.md's "No Over-Engineering" — recorded here as the deliberate,
   auditable non-decision (per the arch reviewer's request).

3. **Review nits addressed in reconciliation** (all three passes returned `pass`):
   - *Regression guard for the refactor* (craft [should-fix] + arch [nit]): added
     `tests/jira-query.test.js` covering the extracted pure helpers
     (`stripJiraMarkup`, `formatIssue`) — the moved logic was previously untested.
   - *AC1 testability* (compliance [nit]): extracted a pure `buildInProgressJql(projects)`
     and unit-tested the no-lookback contract (`statusCategory = "In Progress"`,
     `ORDER BY updated ASC`, and asserts NO `updated >=` clause).
   - *Misleading config path* (compliance [nit]): `list-inprogress.js`'s
     config-missing errors now name `config/jira.json` (was a non-existent
     `jira-filters.json`, copied from `fetch-jira.js`).
   - *Doc-boundary accuracy*: `docs/architecture.md` module-boundaries now
     enumerate `scripts/lib/jira/**` + `scripts/lib/github/open-prs.js` and the
     "never import a `fetch-*.js` script (its `main()` runs at load)" rule —
     this resolves 009-01's deferred architecture.md item too.

4. **AC4 de-dupe** is an orchestrator-level instruction in SKILL.md (skip an
   in-progress entry whose JIRA key already appeared in the recently-updated JIRA
   section), consistent with how daily-note composition lives in orchestrator
   prose. Full suite: **110/110 green on Node 20**.

Deferred (non-gating):

- **Shared `mapJiraError()`** — the 401/no-status/certificate error-message
  mapping is duplicated across `fetch-jira.js` and `list-inprogress.js`.
  *Trigger:* a 3rd caller or the next JIRA-script change (ADR-0002 rule-of-three).
- **`toMs` duplication** — byte-identical in `open-prs.js` and `staleness.js`;
  kept per-source (avoids coupling two source-specific staleness modules).
  *Trigger:* a 3rd staleness source forces an extract-vs-duplicate decision.
- **`{}` → `key:null` phantom** in `extractInProgress` is consistent with
  009-01's `extractOpenPrs` (both surface `{}`; unreachable in real data since
  `formatIssue` always sets a key). Left consistent across both slices
  deliberately — skipping keyless items would require changing both.
- **`fetch-jira.js` config-missing message** still names the old path (pre-existing;
  out of this slice's scope — only the new `list-inprogress.js` copy was fixed).

### Reconciliation sweep

| Artifact | Disposition | Rationale |
|----------|-------------|-----------|
| `README.md` | `no-op` | Front door unaffected by this internal data-source slice. |
| `docs/specs/README.md` | `updated` | Regenerated via `workflow.py status-board`. |
| `docs/product-vision.md` | `no-op` | No behavior/scope drift. |
| `docs/architecture.md` | `updated` | Module-boundaries now enumerate `lib/jira/**` + `lib/github/open-prs.js` and the no-import-`fetch-*.js` rule. |
| `docs/decisions/**` | `no-op` | No ADR — precedent-following refactor; rationale recorded in the deviation log above. |
| `docs/contracts/**` | `no-op` | CLI-output-envelope honored via the shared `envelope()` producer (schema test unchanged). |
| Primer surfaces: `CLAUDE.md` / `AGENTS.md` | `no-op` | Spec still in flight (009-03 pending) — no close-out compression yet. |
| `docs/inbox.md` | `no-op` | Nothing resolved by this slice. |
| `docs/refinement-todo.md` | `no-op` | The spec-009 deferrals section (added in 009-01) still current; new deferrals logged slice-local above. |
| `docs/memory/**` | `deferred` | Memory-sync at spec close-out (after 009-03). |
