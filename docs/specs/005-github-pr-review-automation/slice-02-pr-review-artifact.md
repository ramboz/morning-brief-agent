---
status: DRAFT
dependencies: ["005-01"]
last_verified: 2026-06-18
---

## Slice 005-02 - pr-review-artifact

**Goal:** For a detected review request, run the `pr-review` skill and write a
review artifact for the user to inspect.

**DoR:**
- [ ] Slice 005-01 can identify at least one candidate PR.
- [ ] PR diff, file list, comments, and CI status can be fetched for the
      candidate.

**Acceptance Criteria:**

1. **Review context is sufficient.** The review prompt includes PR description,
   changed files or diff summary, comments, and failed checks when available.
2. **The review is written locally first.** Output is saved to Obsidian or an
   `output/github-reviews/` artifact before any native GitHub staging.
3. **The review uses the installed review framework.** Findings lead, severity
   is clear, and file/line references are included when available.

**DoD:**
- [ ] A sample review artifact exists for one PR or fixture.
- [ ] The workflow records skipped context when diffs or comments cannot be
      fetched.

**Anti-horizontal-phasing check:** The user can read a complete draft review
without opening the implementation conversation.

### Deviation log (after reconciliation)

_Not started._

