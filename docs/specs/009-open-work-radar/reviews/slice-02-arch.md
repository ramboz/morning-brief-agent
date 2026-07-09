---
slice: 009-02 — jira-inprogress-staleness
pass: arch
verdict: pass
reviewer: jig:reviewer
reviewed_at: 2026-07-09T15:58:35Z
prompt_source: review.py arch
---

Arch — slice 009-02. Independent jig:reviewer. VERDICT: pass.
Extraction of lib/jira/query.js out of fetch-jira.js is the correct boundary (fetch-jira.js runs main() at load; mirrors list-open-prs.js→lib/github.js precedent). Two concrete consumers satisfy architecture.md "repeated concrete need". Blast radius low; no cycles. staleness.js (business-day) deliberately distinct from 009-01 open-prs.js (calendar-day) — right call, no premature shared abstraction. NO ADR required (precedent-following refactor, no behavioral trade-off) — record the non-decision in the deviation log.
[nit] shared query.js lacks smoke/unit test (add). [nit] toMs duplicated byte-for-byte (per-source ownership OK; flag for 3rd source). Reconciliation: update architecture.md module-boundaries to enumerate lib/jira/** + lib/github/open-prs.js.
