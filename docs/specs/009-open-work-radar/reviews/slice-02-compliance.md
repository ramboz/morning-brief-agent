---
slice: 009-02 — jira-inprogress-staleness
pass: compliance
verdict: pass
reviewer: jig:reviewer
reviewed_at: 2026-07-09T15:58:35Z
prompt_source: review.py compliance
---

Compliance — slice 009-02. Independent jig:reviewer. VERDICT: pass. All ACs met.
Business-day math verified exhaustively (Friday→Monday=1/fresh, boundaries at 3=stale & 5=very-stale, weekends excluded, unparsable→very-stale, empty, sort). AC1 no-lookback query (statusCategory="In Progress", ORDER BY updated ASC, no updated>=). AC4 de-dupe + AC3 stale-only in SKILL.md. AC5 read-only + fault isolation.
Nits (→reconciliation): config-missing msg named wrong path (jira-filters.json); runInProgress JQL was inspection-only (extract buildInProgressJql); truncation warning flips ok:false.
