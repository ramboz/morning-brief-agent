---
slice: 008-02 - script-and-config-contracts
pass: reconciliation
verdict: pass
reviewer: jig:reviewer
reviewed_at: 2026-07-02T18:41:59Z
prompt_source: review.py reconciliation
---

Reconciliation pass — pass. Every deviation-log and sweep claim verified against code/docs:
- `mode` is an open non-empty string with `write`/`stage` in the enumerated labels; the test loops all six required fields and exercises the real `envelope()` producer across operational modes; the wide mode vocabulary is genuinely emitted across shipping scripts.
- `ajv`/`ajv-formats` are devDeps; `config/main.example.json` reads `plugin`/`script` with an accurate advisory note; `docs/refinement-todo.md` marks the Slack gather_method residual resolved.
- The config-as-contract ADR-deferral is sound (single-user tool, one consumer per family, documented revisit trigger) — right altitude, no ADR forced.

Two non-blocking nits from the review were addressed post-verdict: (1) the sweep's "11 cases" corrected to "10 `test()` blocks" (suite total 57/57 unaffected); (2) two further 007-03 residuals (corp `gather_method` taxonomy; `output/github-reviews/` surface enumeration) now explicitly dispositioned as *deferred* in the sweep and left tracked in refinement-todo's 007-03 note, rather than silently widening this slice's reviewed scope.
