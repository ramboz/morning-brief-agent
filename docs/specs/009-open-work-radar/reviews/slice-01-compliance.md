---
slice: 009-01 — github-open-pr-staleness
pass: compliance
verdict: pass
reviewer: jig:reviewer
reviewed_at: 2026-07-09T15:16:32Z
prompt_source: review.py compliance
---

Compliance pass — slice 009-01 (github-open-pr-staleness). Independent jig:reviewer, read-only.

VERDICT: pass. All ACs met.
- AC1 authored open PRs per instance, normalized (runOpenPrs + extractOpenPrs); tested incl. instance-correct URL passthrough.
- AC2 staleness 3/7 configurable; boundary tests at/just-under 3d & 7d + overrides.
- AC2a draft flag passthrough, tested.
- AC3 stale-only daily surfacing documented in SKILL.md (orchestrator surfacing per Assumption A3); classification data tested.
- AC4 read-only (githubGet only).
- AC5 fault isolation via gatherSurface; extract-side tested, error-note side code-reviewed.

Non-blocking notes (→ reconciliation): AC5 error-capture path not unit-tested (only extract layer); ageInDays returns 0 (→fresh) on missing/unparsable updated_at (could hide a PR); config/output JSON Schemas deferred project-wide; deviation log + reconciliation sweep still to be produced before DONE.
