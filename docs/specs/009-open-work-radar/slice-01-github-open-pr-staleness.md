---
status: DONE
dependencies: []
last_verified: 2026-07-09
arch_review: true
---

## Slice 009-01 — github-open-pr-staleness

**Goal:** Surface the user's own open authored PRs that have gone stale — no
activity past the threshold — across both github.com and corporate GitHub, in
the daily brief.

**DoR:**
- [ ] github.com and/or corporate GitHub access path is available (reuses the
      existing `fetch-github-*.js` auth + org config).
- [ ] Confirmed: `/search/issues?q=is:open is:pr author:@me` returns authored
      open PRs with `updated_at` on both instances (Assumption A1).

**Acceptance Criteria:**

1. **Authored open PRs are detected per instance.** For each enabled instance,
   the user's open, non-merged authored PRs are fetched (scoped to configured
   orgs), each with repo, PR number, title, instance-correct URL, `draft`
   flag, and last-activity timestamp.
2. **Staleness is computed and classified.** Each PR is tagged `fresh`,
   `🟡 stale` (≥ 3 days no activity), or `🔴 very-stale` (≥ 7 days), using
   configurable thresholds (defaults 3 / 7). "Activity" is the PR's
   `updated_at` (latest of push/comment/review).
2a. **Draft PRs are distinguishable.** Draft PRs are labelled as such so they
    can be de-emphasised (a draft that's WIP-by-intent is not the same alert as
    a ready PR waiting on a merge).
3. **The daily brief shows only the stale ones.** The brief's Open Work section
   lists PRs classified `🟡`/`🔴` only (fresh PRs are withheld until slice
   009-03's Monday inventory), each with its deep link and age (e.g. "no
   activity 5d"). When nothing is stale, the section is omitted.
4. **Read-only.** No PR is merged, closed, commented on, or modified.
5. **Fault isolation.** If one instance's query fails (auth/VPN/API), the other
   still reports and the failure is noted, never silently dropped.

**DoD:**
- [ ] All ACs pass; full test suite green on Node 20 (no regressions).
- [ ] Staleness classification has unit coverage with fixtures at each boundary
      (just-under / just-over 3d and 7d; a draft PR; an empty result).
- [ ] Reviewed by `reviewer` subagent (compliance + craft; arch pass because
      this slice establishes the open-work data surface).
- [ ] Sample/fixture JSON captured with any sensitive repo data redacted.
- [ ] Deviation log produced under this slice heading.
- [ ] Reconciliation sweep produced under this slice heading.

**Anti-horizontal-phasing check:** After this slice, the user opens the daily
brief and sees "these authored PRs of yours have stalled" with links — without
scanning GitHub manually — even before the JIRA and Monday slices land.

### Deviation log (after reconciliation)

The original ACs are preserved above. Implementation notes:

1. **Pure-lib / runner / fetch split.** Delivered `scripts/lib/github/open-prs.js`
   (pure `classifyPrStaleness` + `extractOpenPrs`, no network/fs/env) and a thin
   `scripts/list-open-prs.js` runner (envelope `tool: "github_open_prs"`,
   `data.openPRs[]`), mirroring the `list-review-requests.js` / `review-requests.js`
   precedent. The fetch (`runOpenPrs`) went into the shared `scripts/lib/github.js`
   alongside `runBrief`/`runSearch` (not into `open-prs.js`) to keep the classifier
   100% pure. `npm` script `list:open-prs` added; thresholds read from
   `config/main.json` `open_work.pr` (defaults 3/7), documented in `main.example.json`.

2. **Review nits addressed in reconciliation** (all three passes returned
   `pass`; these were `[nit]`/notes folded in here):
   - *Per-org fault tolerance* (arch): `runOpenPrs` now wraps each org query in
     try/catch — a single failing org no longer drops the whole instance's PRs;
     surviving orgs' PRs are returned and per-org failures are surfaced via
     `gatherSurface` into the envelope `errors[]`. It rethrows **only** when every
     query fails, so total-instance failures are still classified (auth vs.
     unreachable) by `gatherSurface`.
   - *Unparsable timestamp no longer hidden* (compliance): a missing/unparsable
     `updated_at` now classifies as `very-stale` (surfaced, `ageDays: null`,
     sorted first) instead of `fresh`/hidden. `toMs` guards `null`/`''`
     explicitly (`new Date(null)` is epoch 0, not Invalid). Added 2 regression
     tests.
   - *Pagination cap* (craft/arch): added a comment noting `per_page: 50` with no
     Link pagination — sufficient for a personal stale view; revisit for 009-03's
     full Monday inventory.

3. **Base integration (mid-implementation rebase).** The slice was branched off a
   stale local `main` (14 commits behind `origin/main`). It was rebased onto
   `origin/main` (which carries specs 006/007/008 + `--jql/--channels`). Only
   conflict: the status board (`docs/specs/README.md`) — resolved by taking
   origin's board and regenerating with `workflow.py status-board`. The worktree
   also needed a real `npm install` for spec 008's `ajv`/`ajv-formats` schema-test
   deps. Full suite: **87/87 green on Node 20** on the integrated base.

Deferred (non-gating; logged for a later slice/PR):

- **`gatherSurface` error-branch unit test** — the auth/unreachable
  classification branches are exercised only by code review + a partial-failure
  path, not a dedicated test (needs a `fetch` mock harness the project doesn't
  have yet). *Resolution trigger:* when a fetch-mock harness lands, or on the
  next change to the GitHub list scripts.
- **`--search` sets `ok:false`** for the intentional not-implemented state
  (cosmetic; the orchestrator only calls `--brief`).
- **Shared `loadGithubSection` helper** — `loadSection` is now the 3rd site of
  the `loadConfig('github')` + key-fallback pattern. Deferred per ADR-0002
  rule-of-three until a 4th caller (this variant also adds `altKeys` +
  `DEFAULT_CONFIG`).
- **`write-brief.js` integration** — the scheduled composer still only renders
  ai_radar; Open Work is surfaced via the `morning-assistant` orchestrator
  (consistent with every non-ai_radar tool today, per Assumption A3). Tracked
  for the write-brief/MCP convergence.
- **`docs/architecture.md` module-boundary wording** still says `fetch-*.js`;
  the `list-*.js` + `lib/github/*` transform pattern (from spec 005, extended
  here) has outpaced it. Doc-drift only — see sweep.

### Reconciliation sweep

| Artifact | Disposition | Rationale |
|----------|-------------|-----------|
| `README.md` | `no-op` | Project front door unaffected by this internal data-source slice. |
| `docs/specs/README.md` | `updated` | Regenerated via `workflow.py status-board` (009 rows + rebased 006/007/008). |
| `docs/product-vision.md` | `no-op` | No behavior/scope drift; radar was already in scope via spec 009 overview. |
| `docs/architecture.md` | `deferred` | Module-boundary text (§ near line 266) still names `fetch-*.js`; the `list-*.js` + `lib/github/*` pattern predates this slice (spec 005). *Trigger:* next edit to the module-boundaries section, or a docs-consolidation slice. Also mirrored to `docs/refinement-todo.md`. |
| `docs/contracts/**` | `no-op` | CLI-output-envelope contract honored by construction — `list-open-prs.js` emits via the shared `envelope()` producer that `tests/script-envelope.schema.test.js` validates; no per-tool envelope fixture required. |
| Primer surfaces: `CLAUDE.md` / `AGENTS.md` | `no-op` | Spec still in flight (009-02/03 pending) — no close-out compression yet. |
| `docs/inbox.md` | `no-op` | No items resolved by this slice. |
| `docs/refinement-todo.md` | `updated` | Two cross-slice deferrals (architecture.md wording; shared `loadGithubSection` helper) mirrored under an "Open-work radar (spec 009)" section. |
| `docs/memory/**` | `deferred` | Memory-sync to run at spec close-out (after 009-03) to capture the open-work/staleness pattern. |
| `docs/decisions/**` | `no-op` | No load-bearing decision with rejected alternatives; the pure-lib/runner split follows the existing 005 precedent (no new ADR warranted). |
