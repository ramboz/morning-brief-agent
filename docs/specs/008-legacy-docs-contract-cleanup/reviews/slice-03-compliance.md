---
slice: 008-03 - legacy-cowork-doc-triage
pass: compliance
verdict: pass
reviewer: jig:reviewer
reviewed_at: 2026-07-02T18:48:07Z
prompt_source: review.py implementation
---

Compliance pass — pass. All three ACs + DoD met:
- AC1: architecture.md § Legacy documentation gives an explicit disposition for every surface (CLAUDE.md, README.md, vision doc, root specs/, skills/**, brief.md).
- AC2: banners on CLAUDE.md / README.md / vision doc flag the obsolete Cowork/browser-first gather + DM-to-self draft framing as superseded and point to the current source of truth (accurate ADR-0004/ADR-0005 refs).
- AC3: legacy docs retained (banners prepended, bodies intact) and still linked; removals explicitly deferred.
- DoD: AGENTS.md pointer + product-vision.md open-question resolved + architecture.md disposition section all present; no removals bundled. Every referenced ADR/doc and the #legacy-documentation anchor resolve.
Note: the reviewer flagged README.md:42 ("Codex/jig workflow plus brief shell") as a possible in-body edit — verified it is PRE-EXISTING content (my change is banner-only, confirmed via git diff), so no deviation.
