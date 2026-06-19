# Learnings

> Status: Draft (wizard-generated)
>
> Dead ends, failed approaches, and "we tried X and here's why it didn't work."
> The institutional memory that ADRs don't capture — these are not decisions,
> they're anti-patterns and gotchas discovered in practice.
>
> Update via `/jig:memory-sync` during reconciliation.

<!-- Learnings below. Format: ## Title, followed by what happened and what to do instead. -->

## Scheduled-run checks must read the JSON envelope, not the exit code

`scripts/write-brief.js` (`emitAndExit`) always calls `process.exit(0)`, even
for `ok:false` error envelopes. So any scheduled-run wrapper (Codex automation,
cron, future failure-state slice 003-03) that keys off the process exit code
will silently treat failed runs as successful. Instead, detect failure from the
JSON envelope: `ok` is false, top-level `errors` is non-empty, the output is
invalid JSON, or the command timed out. The 003-02 automation prompt
(`docs/operations/daily-brief-automation.md`) follows this pattern — reuse it.
