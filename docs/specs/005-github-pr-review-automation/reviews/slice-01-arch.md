---
slice: 005-01 - detect-review-requests
pass: arch
verdict: pass
reviewer: jig:reviewer
reviewed_at: 2026-07-01T21:49:23Z
prompt_source: review.py arch-review
---

Arch pass — architecturally clean; new pure module (lib/github/review-requests.js) + thin CLI (list-review-requests.js) reusing runBrief/DEFAULT_CONFIG, no layering violation, standard JSON envelope preserved. No blockers. Real finding (FIXED): fixture carried a subject field that real enrichNotification output lacks, so the subject.url fallback was never exercised on realistic data — fixture now mirrors post-enrichment shape (no subject) and a dedicated test defends the subject.url fallback for raw notifications. Deferred nits: shared loadGithubSection helper once a third caller appears; predicate redundancy documented.
