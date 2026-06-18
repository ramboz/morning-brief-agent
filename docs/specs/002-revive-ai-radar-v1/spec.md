---
status: IN_PROGRESS
---

# Spec 002: Revive AI Radar v1

## Overview

Revive the existing AI Radar slice as the first useful daily output after
jig adoption. The current implementation already fetches sources, triages
with Codex/Claude/heuristic fallback, renders Markdown, and writes fixtures;
this spec narrows the source scope and makes the result match the revived
v1 goal in `AGENTS.md`.

The target is not a news product. The target is a small, readable,
Obsidian-ready digest that answers: "what should I do with this signal?"

## SPIDR analysis

**Axis: Data.** The value comes from using a smaller, higher-signal source
set first, then validating output quality with a real run and fixture.

## Slices

1. **`002-01 scope-and-source-trim`** - Align config and fetch support with
   AI Radar v1 non-goals.
2. **`002-02 fixture-backed-real-run`** - Produce and save a real-run fixture
   that demonstrates the trimmed slice.
3. **`002-03 action-layer-polish`** - Tighten the Markdown action layer so the
   daily read is useful, not just summarized.

