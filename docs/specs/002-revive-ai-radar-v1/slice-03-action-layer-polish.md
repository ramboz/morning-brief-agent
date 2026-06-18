---
status: DRAFT
dependencies: ["002-02"]
last_verified: 2026-06-18
---

## Slice 002-03 - action-layer-polish

**Goal:** Make the AI Radar Markdown answer "what should I do?" with concise,
specific actions tied to the highest-value items.

**DoR:**
- [ ] A current fixture exists from slice 002-02.
- [ ] The current action rendering has been reviewed against the daily-use goal.

**Acceptance Criteria:**

1. **Actions are specific.** The `What Should I Do?` section names concrete
   review, save, evaluate, or ignore actions rather than generic summary text.
2. **Actions are capped.** The digest stays readable by limiting actions to the
   highest-signal items.
3. **Low-signal days remain calm.** When triage finds little of value, the
   action layer says so clearly without creating fake urgency.

**DoD:**
- [ ] Fixture Markdown demonstrates both at least one actionable item and the
      fallback wording for quiet days, using a fixture or targeted test input.
- [ ] Renderer or triage changes stay local to AI Radar modules.

**Anti-horizontal-phasing check:** The daily reader gets a more decisive AI
Radar section immediately, not just cleaner internals.

### Deviation log (after reconciliation)

_Not started._

