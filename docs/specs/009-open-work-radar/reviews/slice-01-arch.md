---
slice: 009-01 — github-open-pr-staleness
pass: arch
verdict: pass
reviewer: jig:reviewer
reviewed_at: 2026-07-09T15:16:33Z
prompt_source: review.py arch
---

Arch pass — slice 009-01 (establishes the open-work data surface). Independent jig:reviewer, read-only.

VERDICT: pass. Coherent; mirrors the proven 005 list-review-requests pattern. No blockers.
Strengths: pure-lib/runner/fetch split; now-injectable deterministic staleness; thresholds in cross-tool main.json open_work block (right seam for JIRA 009-02); runner returns ALL classified PRs so 009-03 Monday view needs no re-fetch (forward-compatible).
[nit] runOpenPrs per-org loop has no per-org try/catch — one failing org throws and drops the whole instance's PRs; runSearch already wraps per-org. Match that tolerance.
[nit] per_page:50 no pagination — 009-03 full Monday inventory could truncate for heavy users.
[nit] Wired into morning-assistant orchestrator only, not write-brief.js (the Codex-scheduled composer) — consistent with every non-ai_radar tool today (A3), but scheduled path won't render until write-brief integration.
Open questions (→ reconciliation): shared staleness primitive vs per-source when 009-02 adds business-day math; envelope ok:false conflates "any error" with "no data" (pre-existing); architecture.md module-boundary text still says fetch-*.js, hasn't caught up to list-*.js + lib/github/* transform pattern.
