---
status: DRAFT
---

# Spec 004: Slack Plugin Triage

## Overview

Use the installed Slack plugin as the primary Slack integration path for daily
digest, notification triage, and review-first reply drafts. Existing Slack
scripts remain fallback/reference material until this spec supersedes them.

## SPIDR analysis

**Axis: Interface.** The plugin changes the interface from custom Slack API
scripts to native Codex Slack skills and tools.

## Slices

1. **`004-01 bounded-digest-and-triage`** - Produce a scoped Slack digest and
   personal triage section.
2. **`004-02 native-draft-workflow`** - Use native Slack drafts for likely
   replies when explicitly enabled.
3. **`004-03 fallback-and-coverage-notes`** - Document script fallback and
   incomplete-coverage behavior.

