---
status: DONE
dependencies: ["002-02"]
last_verified: 2026-06-18
---

## Slice 002-03 - action-layer-polish

**Goal:** Make the AI Radar Markdown answer "what should I do?" with concise,
specific actions tied to the highest-value items.

**DoR:**
- [x] A current fixture exists from slice 002-02.
- [x] The current action rendering has been reviewed against the daily-use goal.

**Acceptance Criteria:**

1. **Actions are specific.** The `What Should I Do?` section names concrete
   review, save, evaluate, or ignore actions rather than generic summary text.
2. **Actions are capped.** The digest stays readable by limiting actions to the
   highest-signal items.
3. **Low-signal days remain calm.** When triage finds little of value, the
   action layer says so clearly without creating fake urgency.

**DoD:**
- [x] Fixture Markdown demonstrates both at least one actionable item and the
      fallback wording for quiet days, using a fixture or targeted test input.
- [x] Renderer or triage changes stay local to AI Radar modules.

**Anti-horizontal-phasing check:** The daily reader gets a more decisive AI
Radar section immediately, not just cleaner internals.

### Implementation close-out

The action layer is now renderer-owned:

- high-signal actions are score-gated, sorted by score, and capped at three by
  default;
- visible action wording uses concrete review, skim/save, or evaluate/ignore
  verbs tied to item titles;
- actions are selected only from items rendered in the digest body, so the
  action list does not point at hidden context;
- quiet or low-signal days render a calm "No action needed today" message
  instead of inventing urgency.

The Claude triage prompt now asks for concrete action verbs when the model does
return an action, but the Markdown renderer still enforces the final action
selection and wording.

Verification:

```bash
python3 /Users/ramboz/.codex/plugins/cache/jig/jig/1.12.0/skills/tdd-loop/tdd.py detect .
node --check scripts/lib/ai-radar/render.js
node --check scripts/lib/ai-radar/triage.js
node scripts/fetch-ai-radar.js --brief --save-fixture
```

`tdd.py detect .` found no configured pytest/vitest/jest runner, so targeted
renderer checks plus the AI Radar fixture refresh remain the verification gate
for this slice. The refreshed real-run fixture demonstrates an actionable item
in `tests/fixtures/ai-radar.md`; `tests/fixtures/ai-radar-quiet.md`
demonstrates the quiet-day fallback wording.

### Deviation log (after reconciliation)

Reviewer verdicts:

- Compliance pass: pass.
- Craft pass: pass.

No source-scope deviations were introduced. The slice still changes only AI
Radar renderer/triage behavior plus fixture/spec documentation.

Accepted reconciliation notes:

- The Markdown digest contract changed: `What Should I Do?` now uses
  renderer-owned action selection and wording. `tests/fixtures/ai-radar.md`,
  `tests/fixtures/ai-radar.json`, and `tests/fixtures/ai-radar-quiet.md`
  capture the updated contract.
- Verification remains fixture/manual-check based because no committed
  pytest/vitest/jest runner exists for this repo. `docs/refinement-todo.md`
  records this under the contract-artifact and test-strategy deferrals.
- The renderer now normalizes grouped item `action` fields to the visible
  action wording, but `scripts/lib/ai-radar/triage.js` still has its own
  heuristic action wording for lower-level triage fallback. This is accepted as
  non-blocking because `renderAiRadarDigest` owns the final Markdown and JSON
  fixture action contract; a future cleanup can remove or share the older
  heuristic wording if it becomes a repeated drift point.
- No architecture boundary changed; no ADR was needed. `docs/conventions.md`
  was not edited because conventions changes require explicit human approval,
  and this slice did not introduce a durable new project-wide testing rule.
- `docs/inbox.md` had no items to triage.
