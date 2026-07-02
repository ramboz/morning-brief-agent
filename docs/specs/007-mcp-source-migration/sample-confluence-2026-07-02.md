# Sample Confluence brief section — 2026-07-02 (slice 007-02 close-out)

This sample has two parts:

1. An **illustrative format template** showing the shape of the rendered
   daily-note Confluence section when the MCP tools return watched-page changes
   and mentions. This is a hand-authored template, **not** a captured live run —
   there is no Confluence/wiki MCP server connected in this session and no
   Confluence credentials, so a live "Pages Needing Attention" listing cannot be
   produced here honestly.
2. The **real graceful-degradation behavior**, captured by actually running
   `node scripts/fetch-confluence.js --brief` in this repo. This demonstrates
   the script fallback remaining available and reporting fallback status instead
   of failing silently, and the DoD "clear no-results / unavailable note."

Confluence is read-only in this project, so neither part contains a Staged
Drafts entry — the workflow gathers, triages, and renders only.

---

## Part 1 — Illustrative rendered section (format template, NOT a live run)

When the Confluence/wiki MCP tools (or the script fallback) return items, the
section renders like this. Every page links to its Confluence URL; every page
shows its `changeSummary`; @mentioned pages state what was asked; the Coverage
line names the gather path and per-space state.

```markdown
### Pages Needing Attention
- 📝 **[Auth Service Architecture](https://confluence.corp.example.com/display/ENG/Auth+Service+Architecture)** — `ENG`
  ~45 words added, ~12 removed — @alice added a token-refresh edge-case section
  *(Engineering > Backend · v14 · 2h ago)*

- 🔔 **[Deployment Runbook](https://confluence.corp.example.com/display/OPS/Deployment+Runbook)** — `OPS` *(you were mentioned)*
  "Can @you review the rollback section before we publish?"
  *(Operations · v3 · 3h ago)*

- 📝 **[Q2 Roadmap](https://confluence.corp.example.com/display/PROD/Q2+Roadmap)** — `PROD`
  new page
  *(Product · v1 · 5h ago)*

### Coverage
_Gathered via Confluence/wiki MCP tools. Quiet this run: INFRA. No spaces unreachable._
```

If every page in the lookback window was a trivial change, the section degrades
to a single clear no-results line instead:

```markdown
### Confluence
_6 pages updated — all trivial changes filtered._
```

---

## Part 2 — Real fallback run (graceful degradation)

There is no Confluence/wiki MCP server connected in this session, so the
workflow falls back to the script. Running the script with no Confluence
credentials configured produces the standard `ok: false` envelope:

```bash
$ node scripts/fetch-confluence.js --brief
```

```json
{"ok":false,"tool":"confluence","mode":"brief","timestamp":"2026-07-02T16:22:05.134Z","data":null,"errors":["CONFLUENCE_BASE_URL not set"]}
```

Per the Error-handling table in `skills/morning-confluence/SKILL.md`, an
`ok: false` envelope is reported (not swallowed). The rendered daily-note line
degrades to:

```markdown
### Confluence
_Confluence: unavailable — CONFLUENCE_BASE_URL not set (Confluence/wiki MCP tools not connected this run; script fallback returned ok:false)._
```

This is the honest end-to-end fallback chain: **Confluence/wiki MCP unavailable
→ script fallback → `ok: false` unavailable envelope → section reports
"Confluence: unavailable — &lt;reason&gt;"** instead of failing silently or
omitting the section.

---

## How this maps to the acceptance criteria

1. **AC1 — Relevant page updates are fetched.** The primary path (Part 1) runs
   the two-pass scan (recently-modified pages + mention/search hits) scoped to
   `config/confluence.json`'s `spaces`, deduped by page id with mention
   precedence, then pre-filtered (`exclude_title_patterns`,
   `skip_if_only_mentions` + `my_context_keywords`, `min_change_chars`) and
   prioritized (@mentions highest; decision records/runbooks/arch docs;
   significant changes; skip pages the user edited).
2. **AC2 — The section is read-only.** No part of this workflow edits a page,
   adds a comment, or stages a draft. The earlier local-MD comment-draft path
   was removed in this slice; the SKILL's inline safety constraints and the
   architecture doc's read-only guarantee prohibit any page/comment write.
3. **AC3 — State is minimal.** Page-version tracking is the plain, inspectable
   `wiki-state.json` (a `lastRun` timestamp and a page id → version map) — no
   database, no complex state.

## DoD

- **Sample output includes at least one page update or clear no-results note.**
  Part 1 shows real page items in the format template (and the "all trivial
  changes filtered" no-results variant); Part 2 shows the clear "unavailable"
  note from the real fallback run.
- **Existing Confluence script fallback is documented.** Part 2 shows the real
  fallback run; the SKILL's Step 1 fallback-scope note and the architecture
  doc's "Confluence: MCP-First With Bounded Fallbacks" subsection document the
  `scripts/fetch-confluence.js` fallback (same two-pass scan, same `spaces`
  scope, standard envelope).
