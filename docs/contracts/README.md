# Contracts

Machine-checkable contract artifacts for the surfaces named in
[`docs/architecture.md` § Contract surfaces](../architecture.md#contract-surfaces).
This directory is deliberately small — it pins the one surface that multiple
producers and consumers actually depend on (the script output envelope) and
records the reasoned decision to *not* over-formalize the rest yet.

## Script output envelope — `script-envelope.schema.json`

Every helper script under `scripts/` writes a single JSON envelope to stdout
(diagnostics go to stderr). The envelope is produced by `envelope()` in
[`scripts/lib/config.js`](../../scripts/lib/config.js):

```json
{ "ok": true, "tool": "jira", "mode": "brief",
  "timestamp": "2026-07-02T08:00:00.000Z", "data": { }, "errors": [] }
```

- **Artifact:** [`script-envelope.schema.json`](script-envelope.schema.json) —
  JSON Schema (draft 2020-12), the canonical artifact for internal data shapes /
  CLI output per jig's contracts guidance.
- **Contract:** `ok` (bool, `errors.length === 0`), `tool` (non-empty string),
  `mode` (non-empty string — primary labels `brief` / `search`, plus operational
  labels scripts emit such as `context`, `draft`, `index`, `cleanup`, `discard`,
  `list`, `stage`, `write`, `unknown`), `timestamp` (ISO 8601 date-time), `data`
  (object | array | null — the tool-specific payload), `errors` (string[]).
  `additionalProperties: false` — no undeclared top-level keys.
- **`data` is intentionally open.** The envelope contract governs the *wrapper*,
  not the per-tool payload. Each tool's payload shape is captured by a fixture
  under `tests/fixtures/` (e.g. `ai-radar.json`) rather than a second schema —
  see the config decision below for the same reasoning applied to payloads.

### Validation command

```bash
nvm use 20 && npm test      # runs tests/script-envelope.schema.test.js
```

[`tests/script-envelope.schema.test.js`](../../tests/script-envelope.schema.test.js)
compiles the schema with `ajv` (draft-2020 build) + `ajv-formats` and asserts:

1. the schema compiles under ajv strict mode;
2. the real `envelope()` producer's success **and** error output conform,
   across `brief`/`search` and the operational modes (`context`, `draft`,
   `index`, `cleanup`, `discard`, `list`, `stage`, `write`, `unknown`);
3. the canonical example fixture
   [`tests/fixtures/script-envelope.example.json`](../../tests/fixtures/script-envelope.example.json)
   conforms;
4. the **AI Radar fixture**, wrapped as `fetch-ai-radar.js` emits it
   (`envelope('ai-radar', 'brief', <ai-radar.json>, [])`), conforms — this is
   how AI Radar and future source fixtures are "checked against the envelope
   contract";
5. malformed envelopes are rejected (missing field, unknown key, bad `mode`
   enum, non-string error item).

This ties the artifact to the actual producer, so drift in `envelope()` or in a
source fixture fails CI (`npm test`).

## Config files — examples remain the contract (for now)

`config/*.example.json` are the committed templates for the eight config
families (`main`, `slack`, `jira`, `confluence`, `github`, `outlook`,
`meetings`, `ai-radar`); the real `config/*.json` are gitignored and local.

**Decision:** the example files remain the config contract for now — no
per-config JSON Schemas are added in this slice.

**Rationale.**
- This is a single-user personal tool with one config consumer per family
  (`scripts/lib/config.js` + the relevant skill). jig's contracts guidance
  calls out exactly this case ("one-off internal tool with a single consumer")
  as a legitimate opt-out from per-surface schemas, and `CLAUDE.md`'s
  "No Over-Engineering" / "flat config" conventions point the same way.
- The config shapes are still evolving as source slices land (spec 007 reshaped
  the Jira/Confluence/GitHub gather surfaces). Freezing eight schemas now would
  create maintenance drag with little payoff, and a stale schema is worse than
  an honest example.
- The committed `*.example.json` files already document every field and are the
  first thing a skill points the user at when config is missing.

**Revisit trigger.** Promote a config family to its own
`docs/contracts/config/<family>.schema.json` (validated the same way as the
envelope) when either (a) a second independent consumer of that config appears,
or (b) config drift causes a real bug. At that point capture the promotion in
an ADR if it becomes a project-wide policy rather than a one-off.

## Other surfaces

The remaining surfaces in `docs/architecture.md` § Contract surfaces
(Markdown digest sections, Daily Brief notes, jig workflow artifacts) keep their
existing artifacts — fixture snapshots under `tests/fixtures/` and the jig spec
lifecycle — and are out of scope for this slice.
