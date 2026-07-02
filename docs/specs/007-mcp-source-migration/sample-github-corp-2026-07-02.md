# Sample Corporate GitHub brief section — 2026-07-02 (slice 007-03 close-out)

This sample has two parts:

1. An **illustrative format template** showing the shape of the rendered
   daily-note Corporate GitHub section when the MCP tools return a review
   request and a failed-CI/Prow item. This is a hand-authored template, **not**
   a captured live run — there is no corporate GitHub MCP server connected in
   this session and no corp GitHub credentials, so a live review-request /
   failed-job listing cannot be produced here honestly. (The corp GitHub MCP
   tools live in the Codex runtime.)
2. The **real graceful-degradation behavior**, captured by actually running
   `node scripts/fetch-github-corp.js --brief` in this repo. This demonstrates
   the script fallback remaining available and reporting fallback status instead
   of failing silently, and the DoD "sample output includes one PR or failure
   item when available — or a clear note."

This slice migrated only the **corporate** GitHub gather path to MCP-first; the
github.com path is unchanged (connector + `fetch-github-com.js`) and is not the
subject of this sample.

---

## Part 1 — Illustrative rendered section (format template, NOT a live run)

When the corporate GitHub MCP tools (or the script fallback) return items, the
section renders like this. Every PR links to its corp URL; each review-request
item names the author and reason; each failed CI / Prow item names the failing
job(s) and links the run (AC2); the Coverage line names which corp gather path
ran and the per-org state.

```markdown
### Corporate GitHub
- 🔴 **INFRA-482: rotate build-cluster credentials** — `myorg/infra` [#91](https://git.corp.adobe.com/myorg/infra/pull/91)
  Review requested by @alice. Ready for review, 3 files changed.
  CI failing: [`prow/e2e-integration`](https://git.corp.adobe.com/myorg/infra/pull/91/checks?check_run_id=1842), [`build`](https://git.corp.adobe.com/myorg/infra/pull/91/checks?check_run_id=1839) → [Review artifact staged]
  *(High · updated 1h ago)*
- ⚠️ **feat: shard the ingest queue** — `myorg/platform` [#204](https://git.corp.adobe.com/myorg/platform/pull/204)
  Your PR — Prow job **`prow/load-test`** failed on the latest push (timeout after 30m); rerun or investigate before merge.
  [View failed run](https://prow.corp.adobe.com/view/gs/.../load-test/1204)
  *(FYI · updated 3h ago)*

### Reviews & Staged Drafts (1)
- [ ] myorg/infra #91 → Review artifact: `output/github-reviews/2026-07-02-corporate-myorg-infra-91.md` · [Open PR](https://git.corp.adobe.com/myorg/infra/pull/91)

### Coverage
_Corporate GitHub gathered via corp GitHub MCP tools. Quiet this run: myorg/docs. No orgs unreachable._
```

The review row links the **local review artifact** by default (ADR-0007). A
"Pending review staged" PR link is added ONLY when `github_corp`'s
`pending_review_staging.enabled` is `true` for that repo — and even then the
pending review is never submitted by the agent.

---

## Part 2 — Real fallback run (graceful degradation)

There is no corporate GitHub MCP server connected in this session, so the
workflow falls back to the script. Running the script with no corp GitHub
credentials configured produces the standard `ok: false` envelope:

```bash
$ node scripts/fetch-github-corp.js --brief
```

```json
{"ok":false,"tool":"github_corp","mode":"brief","timestamp":"2026-07-02T16:35:47.941Z","data":null,"errors":["Corporate GitHub base URL not configured — set GITHUB_CORP_BASE_URL in .env"]}
```

Per the Error-handling table in `skills/morning-github/SKILL.md`, an `ok: false`
envelope is reported (not swallowed). The rendered daily-note line degrades to:

```markdown
### Corporate GitHub
_Corporate GitHub: unavailable — Corporate GitHub base URL not configured — set GITHUB_CORP_BASE_URL in .env (corp GitHub MCP tools not connected this run; script fallback returned ok:false)._
```

This is the honest end-to-end fallback chain: **corp GitHub MCP unavailable →
script fallback → `ok: false` unavailable envelope → section reports "Corporate
GitHub: unavailable — &lt;reason&gt;"** instead of failing silently or omitting
the section.

---

## How this maps to the acceptance criteria

1. **AC1 — PR and issue activity is summarized.** The primary MCP path (Part 1)
   gathers review requests, mentions, authored-PR activity, and failed CI over
   the configured `github_corp.orgs`. The section renders review requests
   (author + reason), authored-PR activity, and issue mentions/assignments.
2. **AC2 — Failed jobs are actionable.** Each failed CI / Prow item in Part 1
   names the failing check/job (`prow/e2e-integration`, `build`,
   `prow/load-test`) and links the run / checks tab — enough name + link context
   to decide whether to investigate. A bare "CI failing" is not allowed.
3. **AC3 — The workflow stays read-first.** No merge, push, close, approve, or
   request-changes action happens in the daily-brief path (either instance, any
   gather path). PR reviews are local artifacts by default and an opt-in native
   *pending* review that is never submitted; issue replies are local-MD
   fragments. The SKILL's inline safety constraints and the architecture doc's
   read-first guarantee enforce this.

## DoD

- **Sample output includes one PR or failure item when available (or a clear
  note).** Part 1 shows a real-shaped corp PR review-request item **and** a
  failed-CI/Prow item in the format template; Part 2 shows the clear
  "unavailable" note from the real fallback run.
- **Relationship to spec 005 PR review automation is documented.** The corp
  MCP-first gather feeds the **same** spec-005 review-first pipeline
  (`list-review-requests.js` → `fetch-github-{com,corp}.js --context` → the
  `pr-review` skill → `write-review-artifact.js` → opt-in
  `stage-review-if-enabled.js`); ADR-0007's staging policy (local artifacts by
  default, opt-in native pending review, never auto-submit) is unchanged by
  007-03. This is stated in `skills/morning-github/SKILL.md` (header +
  Step 3) and in the architecture doc's "Corporate GitHub: MCP-First With
  Bounded Fallbacks" subsection.
```
