---
status: DONE
---

# Spec 007: MCP Source Migration

## Overview

Move Jira, Confluence, and corporate GitHub source slices toward MCP-backed
access where tools are available, keeping existing Node scripts as fallback or
fixture sources.

## SPIDR analysis

**Axis: Interface.** Each source area gets its own vertical MCP-backed path
through fetch, triage, Markdown, and failure reporting.

## Slices

1. **`007-01 jira-mcp-brief-section`** - Jira daily section through MCP tools.
2. **`007-02 confluence-mcp-brief-section`** - Confluence read-only updates
   through MCP tools.
3. **`007-03 github-corp-mcp-brief-section`** - Corporate GitHub notifications
   and PR context through MCP tools.

