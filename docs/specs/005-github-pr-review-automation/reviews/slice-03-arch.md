---
slice: 005-03 - optional-pending-review-staging
pass: arch
verdict: pass
reviewer: jig:reviewer
reviewed_at: 2026-07-01T22:26:45Z
prompt_source: review.py arch-review
---

Arch pass — architecturally sound. Pure gating module under scripts/lib/** boundary; stagePendingReview extracted and reused (good dedup); per-instance {enabled, repos[]} config shape is safe-by-default (enabled:false). Body-only POST invariant, opt-in gate, artifact-preserving fallback all align with ADR-0007 + CLAUDE.md safety constraints. No public-contract break. No blockers. Nit FIXED: divergent instance normalization resolved via shared resolveInstance. Design choice logged: empty-allowlist+enabled = instance-wide opt-in (documented, gated). Reconciliation task DONE: architecture.md open questions on staging policy updated to reference ADR-0007.
