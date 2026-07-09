---
slice: 009-02 — jira-inprogress-staleness
pass: craft
verdict: pass
reviewer: jig:reviewer
reviewed_at: 2026-07-09T15:58:35Z
prompt_source: review.py craft
---

Craft — slice 009-02. Independent jig:reviewer. VERDICT: pass. Findings all nits.
Strengths: UTC-normalized business-day math (DST-safe); runInProgress by statusCategory + ORDER BY updated ASC (keeps oldest on truncation); clean fault isolation + AC4 de-dupe guidance.
[nit should-fix] extracted query.js shared helpers (jiraGet/paginateJql/formatIssue/stripJiraMarkup) have NO regression test — refactor faithful by inspection but unguarded. Add test.
[nit] {} → key:null phantom is IDENTICAL to 009-01 (no divergence); unreachable in real data (formatIssue always sets key); change both or neither.
[nit] JIRA error-message mapping duplicated across fetch-jira.js + list-inprogress.js → shared mapJiraError (rule-of-three).
