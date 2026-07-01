---
status: RECONCILED
dependencies: []
last_verified: 2026-07-01
arch_review: true
---

## Slice 005-01 - detect-review-requests

**Goal:** Surface GitHub PRs where the user has been asked to review, using
notifications or MCP tools where available.

**DoR:**
- [ ] GitHub.com and/or corporate GitHub access path is available.
- [ ] The detection path can distinguish review requests from generic PR
      activity.

**Acceptance Criteria:**

1. **Review requests are detected.** The output includes repo, PR number,
   title, author, URL, and why it was surfaced.
2. **Noise is filtered.** Authored PR activity, mentions, and CI updates are
   not mixed into the review-request queue unless configured.
3. **Both GitHub surfaces are modeled.** GitHub.com and corporate GitHub can
   be enabled independently.

**DoD:**
- [x] Detection output is captured as fixture or sample JSON with sensitive
      repo data redacted if needed.
- [x] Failures mention auth, VPN, or connector availability clearly.

**Anti-horizontal-phasing check:** The user gets a concrete "PRs you were asked
to review" list without opening GitHub notifications manually.

### Deviation log (after reconciliation)

Implementation matched the acceptance criteria as written. Deltas and decisions:

- **New CLI + pure lib split.** Delivered `scripts/lib/github/review-requests.js`
  (pure `extractReviewRequests(instances)` transform) plus a thin runnable
  `scripts/list-review-requests.js` that gathers each enabled surface via the
  existing `runBrief`/`DEFAULT_CONFIG` in `scripts/lib/github.js` — no
  notification fetch/filter/enrich logic was reimplemented. Output envelope:
  `tool: "github_review_requests"`, `data.reviewRequests[]`. `npm` script
  `list:review-requests` added.
- **`--search` intentionally deferred.** Detection-only is this slice's scope;
  `--search` returns an empty queue with a not-implemented note in `errors[]`.
  Search-mode review-request lookup, if wanted, belongs to a later slice/spec.
- **Fixture realism fix (from arch pass).** The initial fixture carried a
  `subject` field that real `enrichNotification` output does not emit, so
  `derivePrNumber`'s `subject.url` fallback was never exercised against
  realistic data. Fixed: the fixture now mirrors the post-enrichment shape (no
  `subject`; PR number derives from the enriched html `url`), and a dedicated
  test constructs a raw notification carrying only `subject.url` to keep the
  fallback path defended. 21/21 tests green on Node 20.
- **Double-filter documented (from craft/arch passes).** The `review_requested`
  predicate exists both upstream in `notificationPassesFilter` (gated on
  `prs_to_review`) and here as a defensive re-filter. A header comment in
  `review-requests.js` now records this as intentional redundancy.

Deferred (non-gating) follow-ups, logged for a later slice:

- Direct unit coverage for the CLI orchestration layer (`gatherSurface`
  fault-isolation, `enabled !== false` toggling, error-message wording). Today
  these are exercised only by a manual no-token smoke run.
- A shared `loadGithubSection` helper in `lib/github.js` — the config-key
  fallback + `enabled !== false` defaulting is now duplicated between
  `list-review-requests.js` and `fetch-github-com.js`. Extract on the third
  caller (ADR-0002 rule of three), not before.

### Reconciliation sweep

- **Config/env contract** (`config/github.example.json`, `.env`) — no-op. Reuses
  existing `github_com`/`github_corp` sections, `GITHUB_COM_TOKEN` /
  `GITHUB_CORP_BASE_URL` / `GITHUB_CORP_TOKEN`; no new config keys introduced.
- **Shared lib** (`scripts/lib/github.js`) — no-op. Imported `runBrief` /
  `DEFAULT_CONFIG` unchanged; no signatures touched.
- **CLI envelope contract** (`docs/architecture.md` "CLI output envelopes") —
  no-op. New `github_review_requests` envelope follows the existing
  `{ ok, tool, mode, timestamp, data, errors }` shape. The project-wide
  `docs/contracts/script-envelope.schema.json` is still uncommitted (pre-existing
  gap tracked under spec 008); the new `reviewRequests[]` item shape is a
  candidate to capture when that schema lands.
- **morning-github SKILL.md** — deferred. The skill still drives detection via
  the mixed-notification brief; wiring the isolated review-request queue into the
  skill's workflow is naturally 005-02's concern (artifact generation consumes
  this queue). No change made here to avoid horizontal churn.
- **Tests** (`npm test`) — updated. 21/21 pass on Node 20 (`engines: >=20`; the
  machine default `node` is v14 and cannot run `node --test`).
- **Architecture doc** — no-op. No module boundary or public contract changed
  beyond the additive new module/CLI, which fit the documented Layer-2 pattern.

