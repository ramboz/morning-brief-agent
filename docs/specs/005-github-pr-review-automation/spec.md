---
status: IN_PROGRESS
---

# Spec 005: GitHub PR Review Automation

## Overview

Detect GitHub PR review requests, gather enough context for review, run the
`pr-review` skill, and write a review-first artifact. Pending GitHub reviews
are optional and must be explicitly enabled.

## SPIDR analysis

**Axis: Path.** Start with detection, then review artifact creation, then
optional native pending-review staging.

## Slices

1. **`005-01 detect-review-requests`** - Find PRs the user has been asked to
   review.
2. **`005-02 pr-review-artifact`** - Run review and write an Obsidian/output
   artifact.
3. **`005-03 optional-pending-review-staging`** - Stage pending GitHub reviews
   only when enabled.

