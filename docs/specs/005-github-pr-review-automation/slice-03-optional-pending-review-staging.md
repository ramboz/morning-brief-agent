---
status: RECONCILED
dependencies: ["005-02"]
last_verified: 2026-07-01
arch_review: true
---

## Slice 005-03 - optional-pending-review-staging

**Goal:** Stage a pending GitHub review only when the repo/user config enables
native staging.

**DoR:**
- [ ] ADR-0007 is accepted or explicitly approved for this slice.
- [ ] The review artifact path from slice 005-02 exists.

**Acceptance Criteria:**

1. **Native staging is opt-in.** The default behavior remains local review
   artifacts unless configuration enables pending reviews.
2. **Pending reviews are never submitted.** The GitHub API call creates a
   pending review only; it does not approve, request changes, comment publicly,
   merge, or push.
3. **Fallback is safe.** If native staging fails, the local review artifact is
   preserved and surfaced.

**DoD:**
- [x] Staging behavior is verified against a safe PR or dry-run substitute.
- [x] Daily note / output links to the pending review or local artifact.

**Anti-horizontal-phasing check:** The user gets a draft in GitHub when they
explicitly want that UX, while preserving a local review-first fallback.

### Deviation log (after reconciliation)

Implementation follows ADR-0007 exactly; no material deviation from the spec's
approach. Deltas and decisions:

- **Opt-in config shape.** Added `pending_review_staging: { enabled: false,
  repos: [] }` under both `github_com` and `github_corp` in
  `config/github.example.json`, OFF by default (AC1), with a documenting
  `note_pending_review_staging`. Semantics: `enabled:false` → local artifacts
  only; `enabled:true` + non-empty `repos` → stage only for listed repos
  (matches bare `repo` or `owner/repo`); `enabled:true` + empty `repos` →
  instance-wide opt-in. **Design choice on record:** the broadest scope is
  reached with the least config (enable + empty allowlist); this is gated behind
  the `enabled` flag and documented in both the module header and the config
  note, but a user flipping only `enabled` gets instance-wide staging.
- **Staging core extracted + reused.** Pulled the pending-review POST out of
  `stage-github-review.js` into a shared `stagePendingReview({ baseUrl, token,
  owner, repo, number, body, toolName })` in `lib/github.js` (single choke point
  for the AC2 body-only safety invariant — no `event`/`state`/`comments`, so the
  review stays PENDING and is never submitted/approved/changes-requested/merged/
  pushed). Both `stage-github-review.js` and the new gated CLI call it, so the
  invariant can't drift between call sites.
- **Gating + safe fallback.** New pure `resolveStagingDecision` in
  `scripts/lib/github/pending-review.js` decides staging from config alone; new
  runnable `scripts/stage-review-if-enabled.js` (npm `stage:review-if-enabled`)
  loads config, resolves the decision, and — when enabled — stages a pending
  review, ALWAYS preserving/surfacing the local `artifactPath` and a clear
  auth/VPN/connector error on any failure (AC3). `--dry-run` reports intent with
  no API call (DoD verification substitute).
- **SKILL.md** gained the opt-in staging step (after the local artifact),
  explicit pending-only/never-submitted framing, and output-linking rules
  (pending review when staged, else local artifact).
- **Review nits fixed inline.** Hoisted a single `resolveInstance` into
  `lib/github.js` (used by both stagers) to remove the divergent `'corp'` vs
  `'corp'/'corporate'` normalization the arch pass flagged; corrected
  `stage-github-review.js`'s stale docstring (no "event: PENDING" — GitHub has no
  such value; pending is the absence of `event`) and its ADR pointer
  (ADR-002 → ADR-0007).

Deferred (non-gating) follow-ups:

- Direct test of the post-POST `catch` path in `stage-review-if-enabled.js`
  (network/HTTP error inside the staging `try`). AC3 is proven via the
  token-missing branch, which uses the identical artifact-preserving fallback
  shape; the throw path is verified by inspection.
- Minor DRY: PR-web-URL construction and `readStdin` are duplicated between the
  two stager CLIs — extract to a shared util on the next concrete need.
- `discard-github-review.js` still cites ADR-002 in its header (not touched by
  this slice); tidy on a future pass.

### Reconciliation sweep

- **Shared lib** (`scripts/lib/github.js`) — updated. Added `stagePendingReview`
  (new export) and `resolveInstance` (new export); no existing signatures
  changed. `stage-github-review.js` refactored to reuse both — behavior-preserving
  (envelope output identical; it now also accepts `instance:"corporate"`, a strict
  widening).
- **Config contract** (`config/github.example.json`) — updated. Added
  `pending_review_staging` under both instances, safe-by-default. The project-wide
  config JSON Schema remains uncommitted (pre-existing gap, spec 008); no schema
  owed here per `docs/architecture.md`.
- **SKILL.md** (`skills/morning-github/SKILL.md`) — updated. Added opt-in staging
  step + discard recovery pointer; existing content preserved.
- **Architecture doc** (`docs/architecture.md`) — updated (closed-decision drift,
  ADR-0010 live-prose rule): the two "GitHub review staging policy" open questions
  (design-principles list + open-questions summary) now record the policy as
  resolved by ADR-0007.
- **CLI envelope contract** — no-op. New `github_pending_review` envelope follows
  the standard shape.
- **Tests** (`npm test`) — updated. 47/47 pass on Node 20 (+11 for this slice).
- **Module boundaries** — no-op. Additive pure module + CLI + shared helpers;
  no boundary or public-contract break.

