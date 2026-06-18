---
status: DRAFT
dependencies: []
last_verified: 2026-06-18
arch_review: true
---

## Slice 008-02 - script-and-config-contracts

**Goal:** Add lightweight contract artifacts for script JSON envelopes and
configuration shapes named in `docs/architecture.md`.

**DoR:**
- [ ] Current script output envelope shape is confirmed.
- [ ] Config examples are reviewed for common fields.

**Acceptance Criteria:**

1. **Script envelope contract exists.** A JSON Schema or equivalent document
   defines `{ ok, tool, mode, timestamp, data, errors }`.
2. **Config contract approach is documented.** The repo either adds per-config
   schemas or records why examples remain the contract for now.
3. **Fixtures point at contracts.** AI Radar fixtures and future source
   fixtures can be checked against the envelope contract.

**DoD:**
- [ ] Contract files are linked from `docs/architecture.md`.
- [ ] Any validation command is documented or deferred explicitly.

**Anti-horizontal-phasing check:** Future source slices get a concrete contract
to preserve, reducing accidental output drift.

### Deviation log (after reconciliation)

_Not started._

