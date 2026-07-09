---
slice: 009-01 — github-open-pr-staleness
pass: craft
verdict: pass
reviewer: jig:reviewer
reviewed_at: 2026-07-09T15:16:33Z
prompt_source: review.py craft
---

Craft (pr-review) pass — slice 009-01. Independent jig:reviewer, read-only.

VERDICT: pass. Findings all nits — none block merge.
Strengths: clean pure-lib/runner/fetch split mirroring review-requests.js; robust against malformed input; reuses githubGet/withRetry/loadConfig/envelope; thorough SKILL.md section (suppression, draft de-emphasis, never-construct-URL, read-only, Monday deferral).
[nit] --search puts message in errors[] → envelope ok:false for an intentional state.
[nit] runOpenPrs per_page:50 with no pagination (fine for personal tool; note for 009-03 full inventory).
[nit] loadSection is 3rd site of loadConfig('github')+section-resolution → candidate for shared loadGithubSection helper (deferring OK; this variant adds altKeys+DEFAULT_CONFIG).
[nit] AC5 test simulates filter(Boolean) at extractOpenPrs layer, not gatherSurface's error-classification branches.
Improvement noted: list-open-prs respects per-instance enabled flag (stricter than sibling fetch scripts).
