---
status: RECONCILED
dependencies: []
last_verified: 2026-07-02
arch_review: true
---

## Slice 008-02 - script-and-config-contracts

**Goal:** Add lightweight contract artifacts for script JSON envelopes and
configuration shapes named in `docs/architecture.md`.

**DoR:**
- [x] Current script output envelope shape is confirmed. `envelope()` in
      `scripts/lib/config.js` emits `{ ok, tool, mode, timestamp, data, errors }`
      (`ok` = `errors.length === 0`; `mode` ∈ {brief, search}).
- [x] Config examples are reviewed for common fields. Eight families
      (`main, slack, jira, confluence, github, outlook, meetings, ai-radar`);
      shapes vary widely and several carry a `note` field.

**Acceptance Criteria:**

1. **Script envelope contract exists.** A JSON Schema or equivalent document
   defines `{ ok, tool, mode, timestamp, data, errors }`.
2. **Config contract approach is documented.** The repo either adds per-config
   schemas or records why examples remain the contract for now.
3. **Fixtures point at contracts.** AI Radar fixtures and future source
   fixtures can be checked against the envelope contract.

**DoD:**
- [x] Contract files are linked from `docs/architecture.md`. The Contract
      surfaces section links `docs/contracts/script-envelope.schema.json` and
      `docs/contracts/README.md`.
- [x] Any validation command is documented or deferred explicitly. `npm test`
      (`tests/script-envelope.schema.test.js`, ajv draft-2020) is documented in
      both `docs/contracts/README.md` and the architecture Contract surfaces
      row.

**Anti-horizontal-phasing check:** Future source slices get a concrete contract
to preserve, reducing accidental output drift.

### Deviation log

- **`mode` modeled as an open non-empty string, not the two-value enum the DoR
  assumed.** The DoR (and CLAUDE.md) frame `mode` as `{brief, search}`, but the
  real `envelope()` producer emits a wider open vocabulary — `context`, `draft`,
  `index`, `cleanup`, `discard`, `list`, `stage`, `write`, `unknown` — across
  shipping scripts. The initial schema used `enum: ["brief","search"]`; the arch
  review caught that it would reject the majority of real envelopes and that the
  brief-only test hid it. Fixed before REVIEWED: `mode` is `type: string,
  minLength: 1` (documented labels, open vocabulary) and the test now exercises
  the operational modes against the real producer. This is the correct call
  (new script ops don't break the contract) and is documented in the schema
  description + `docs/contracts/README.md`.
- **Config contract resolved as a reasoned NON-addition (examples-as-contract).**
  AC2 permits "schemas OR record why examples remain the contract." Chose the
  latter for this single-user tool with one consumer per config family, with a
  concrete two-part revisit trigger in `docs/contracts/README.md`. No per-config
  schemas were authored. Considered an ADR (load-bearing decision with a rejected
  alternative) but deferred — the arch reviewer concurred it is right-altitude
  for a single-user tool and the README's decision + revisit-trigger is the
  durable record; promote to an ADR only if/when it becomes project-wide policy.
- **New devDependencies: `ajv` + `ajv-formats`.** The one new-dependency decision
  in this slice. Justified: the schema is genuinely validated in CI against the
  live `envelope()` producer and fixtures (not a doc-only artifact). Dev-only,
  ecosystem-standard for JSON Schema; consistent with the minimal-deps stance.
- **Closed a refinement-todo residual scoped here.** `config/main.example.json`'s
  `tools.slack.gather_method: "script"` / `gather_fallback: "connector"` reflected
  the pre-plugin taxonomy; updated to `plugin` / `script` with an advisory note
  (the fields aren't consulted by `morning-slack/SKILL.md`, which stays the source
  of truth). Recorded resolved in `docs/refinement-todo.md`.
- **Post-review nits addressed (non-blocking):** added `write`/`stage` to the
  enumerated operational-mode label lists (schema + README + test) for accuracy;
  expanded the missing-required-field negative test to loop all six required
  fields; clarified the AI Radar fixture comment (`normalizeFixtureResult` lives
  in `fetch-ai-radar.js`).

### Reconciliation sweep

- **`docs/contracts/` (new dir)** — *added*: `script-envelope.schema.json`
  (draft 2020-12 envelope contract) + `README.md` (envelope contract, config
  decision, validation command).
- **`tests/`** — *added*: `script-envelope.schema.test.js` (ajv, 10 `test()`
  blocks) + `fixtures/script-envelope.example.json`; full suite 57/57 green on
  Node 20.
- **`docs/architecture.md` § Contract surfaces** — *updated*: CLI-output and
  config rows now link the committed artifacts + validation command; removed the
  "not yet committed" placeholders.
- **`package.json` / `package-lock.json`** — *updated*: `ajv`/`ajv-formats`
  devDeps.
- **`config/main.example.json`** — *updated*: Slack gather taxonomy corrected to
  plugin-first (refinement-todo residual closed).
- **`docs/refinement-todo.md`** — *updated*: the gather_method residual marked
  resolved by this slice.
- **ADR** — *no-op*: config-as-contract deferral captured in the contracts README
  with a revisit trigger; arch review concurred no ADR is warranted at this
  altitude.
- **`docs/conventions.md`** — *no-op*: no new project convention introduced (the
  schema follows jig's contracts guidance; ajv is a tooling choice, not a rule).
- **`CLAUDE.md`** — *deferred*: its legacy Cowork framing is slice 008-03's
  subject, not this slice's.
- **Other 007-03 config/contract residuals** — *deferred* (kept tracked in
  `docs/refinement-todo.md`'s 007-03 note): (a) `config/main.example.json`'s
  `github_corp.gather_method` still reads `"script"` and doesn't model the
  MCP-first corp path spec 007-03 introduced; (b) the `output/github-reviews/`
  review-artifact path is not enumerated under `docs/architecture.md` §
  Contract surfaces. Both are the same *class* as the Slack gather_method fix
  but were outside this slice's reviewed deliverable list; deferred to a
  follow-up config/contract-surface pass rather than silently widening this
  slice's scope after review. Trigger: next config-contract slice, or when a
  second consumer of those surfaces appears.

