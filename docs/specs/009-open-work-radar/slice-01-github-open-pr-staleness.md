---
status: DRAFT
dependencies: []
last_verified:
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

_Not started._
