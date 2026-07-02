---
slice: 008-02 - script-and-config-contracts
pass: arch
verdict: pass
reviewer: jig:reviewer
reviewed_at: 2026-07-02T18:36:54Z
prompt_source: review.py arch-review
---

Arch pass — pass (re-review; prior blocker fixed). JSON Schema draft 2020-12 + ajv is the right artifact for the CLI-output/internal-data-shape envelope surface; wrapper-vs-payload boundary is correct (`data` open, payloads delegated to fixtures). The prior blocker — `mode` enum rejecting real envelopes — is fixed: `mode` is now an open non-empty string documenting primary + operational labels, and the test exercises the operational modes, so no real envelope is rejected. Drift loop is genuinely closed: every envelope in scripts/ is built via `envelope()`, which the test binds to the schema (no escape path). Config-contract deferral is right-altitude for a single-user tool; no ADR required at this altitude.
Nit addressed post-review: `write`/`stage` added to the enumerated label lists for completeness.
