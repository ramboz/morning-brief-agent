---
status: DONE
dependencies: ["005-01"]
last_verified: 2026-07-01
---

## Slice 005-02 - pr-review-artifact

**Goal:** For a detected review request, run the `pr-review` skill and write a
review artifact for the user to inspect.

**DoR:**
- [ ] Slice 005-01 can identify at least one candidate PR.
- [ ] PR diff, file list, comments, and CI status can be fetched for the
      candidate.

**Acceptance Criteria:**

1. **Review context is sufficient.** The review prompt includes PR description,
   changed files or diff summary, comments, and failed checks when available.
2. **The review is written locally first.** Output is saved to Obsidian or an
   `output/github-reviews/` artifact before any native GitHub staging.
3. **The review uses the installed review framework.** Findings lead, severity
   is clear, and file/line references are included when available.

**DoD:**
- [x] A sample review artifact exists for one PR or fixture.
- [x] The workflow records skipped context when diffs or comments cannot be
      fetched.

**Anti-horizontal-phasing check:** The user can read a complete draft review
without opening the implementation conversation.

### Deviation log (after reconciliation)

Implementation satisfied the acceptance criteria. Deltas and decisions:

- **Scriptable-halves split (design deviation, intentional).** A Node script
  cannot run the `pr-review` skill — that is an orchestrator action. So the code
  delivers the two scriptable halves: `buildReviewContext` (normalize `--context`
  PR data into a bundle for the skill) and `renderReviewArtifact` /
  `writeReviewArtifact` (turn the skill's review body into a findings-lead
  Markdown artifact and write it). The `pr-review` invocation is documented as an
  orchestration step in `skills/morning-github/SKILL.md`. Deliverables:
  `scripts/lib/github/review-artifact.js` (mostly pure; only `writeReviewArtifact`
  touches fs) and `scripts/write-review-artifact.js` (stdin JSON → local
  artifact → `github_review_artifact` envelope). `npm` script
  `write:review-artifact` added.
- **Artifact location = `output/github-reviews/`** per accepted ADR-0007
  (repo-local, git-visible, editable before staging). `output/` is gitignored, so
  the committed sample lives in the spec dir
  (`sample-review-artifact.md`), matching spec 004's `sample-digest-*` convention.
- **CI-checks gap closed (AC1).** The `--context` path (`fetchPrContext`) did not
  fetch check-runs, so failed checks were never actually available to the review —
  the exact shallow-review risk ADR-0007 warns about. Fixed by extracting the
  check-run logic that lived inline in `enrichNotification` into a shared
  `fetchCiFailures(baseUrl, token, owner, repo, sha, toolName)` helper in
  `lib/github.js` (rule-of-three: third concrete use), now called by both
  `enrichNotification` (behavior-identical, `fetchCi`-gated) and `fetchPrContext`
  (unconditional for context mode, fault-tolerant). `buildReviewContext` now
  records `'failed checks'` in `missing` when CI data is absent, distinguishing it
  from an explicit empty array ("none reported").
- **Review nits fixed inline.** `pr.number` is coerced with `Number()` in the
  writer so a stdin string survives the bundle's `typeof number` check; stale
  `parseLinkedIssues` JSDoc (removed `defaultOwner`/`defaultRepo` params)
  corrected; UTC intent of the artifact-date prefix documented.

Deferred (non-gating) follow-ups:

- A committed *partial-context* sample artifact showing the rendered
  `> **Missing context:**` note. DoD is currently met via test assertions
  (`github-review-artifact.test.js`); a rendered sample is optional polish.
- Direct unit coverage for `write-review-artifact.js`'s stdin/envelope paths
  (the library halves are unit-tested; the thin CLI is exercised via manual smoke
  runs) — same class of follow-up logged for 005-01's CLI layer.

### Reconciliation sweep

- **Shared lib** (`scripts/lib/github.js`) — updated. Extracted `fetchCiFailures`;
  `enrichNotification` behavior preserved (same tri-state, same `fetchCi` gate,
  same 404-silent fault tolerance — the only change is a reconstructed stderr
  string, not asserted anywhere); `fetchPrContext` gains `ciStatus`/`ciFailures`.
  No signature changes to existing exports; `fetchCiFailures` is a new export.
- **Brief path** (`fetch-github-com.js`, `fetch-github-corp.js`, `runBrief`) —
  no-op / verified. The `fetchCi` gate is unchanged, so the brief makes no extra
  API calls; 36/36 tests green including the pre-existing suite.
- **SKILL.md** (`skills/morning-github/SKILL.md`) — updated. Added the
  review-first artifact workflow (detect via `list-review-requests.js` →
  `--context` fetch → run `pr-review` skill → `write-review-artifact.js` → surface
  in daily note); marked native pending-review staging as opt-in/005-03. Existing
  content preserved.
- **CLI envelope contract** (`docs/architecture.md`) — no-op. New
  `github_review_artifact` envelope follows the standard shape; the project-wide
  `script-envelope.schema.json` remains uncommitted (pre-existing gap, spec 008).
- **Config/env** — no-op. No new config keys; native-staging config lands in 005-03.
- **Tests** (`npm test`) — updated. 36/36 pass on Node 20 (+15 vs the 21-test
  005-01 baseline: 11 in `github-review-artifact.test.js` + 4 in
  `github-ci-failures.test.js`).
- **Architecture doc** — no-op. No module boundary or public-contract change
  beyond the additive helper/module/CLI and the CI field added to `fetchPrContext`'s
  return (non-breaking).

