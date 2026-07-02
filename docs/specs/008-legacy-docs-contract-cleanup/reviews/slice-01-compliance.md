---
slice: 008-01 - adr-filename-index-normalization
pass: compliance
verdict: pass
reviewer: jig:reviewer
reviewed_at: 2026-07-02T18:11:19Z
prompt_source: review.py implementation
---

Compliance pass — all ACs met (re-review after fixing the sole prior finding).

- **AC1 (canonical filenames)** — `adr-0001-draft-staging-mechanism.md` and `adr-0002-draft-generation-and-delivery.md` exist; no legacy `ADR-00N-*.md` remain in `docs/decisions/`.
- **AC2 (links updated)** — every live reference (docs AND the four helper-script `Reference:` header comments) now points at the new `adr-0002-...md` path. Remaining `ADR-002` matches are prose-only number mentions, correctly-linked display text, or out-of-scope immutable spec-004/005 history and `.codex/` tooling.
- **AC3 (useful index)** — `docs/decisions/README.md` lists all 8 accepted+proposed ADRs with readable summaries and status/date tags, verified accurate.
- **DoD** — sound: ADR bodies unchanged (this slice touched filenames + README/link edits only); `adr.py index` genuinely can't parse the legacy `**Status:**` prose without a rewrite the DoD forbids, so the equivalent manual link-resolution index check was substituted.

The initial pass returned needs-changes for four scripts (stage-local-draft.js, discard-github-review.js, build-draft-index.js, cleanup-drafts.js) still citing the old filename; those were fixed and this re-review confirms pass. Incidentally resolves the deferred follow-up at 005-03:81 (discard-github-review.js header). No blockers.
