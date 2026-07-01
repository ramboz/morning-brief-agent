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

## State-file I/O must self-guard against corrupt/unwritable files
scripts/lib/brief/state.js (loadBriefState/updateBriefState) was originally called unguarded from write-brief.js's main(). A corrupt logs/brief-state.json (bad JSON) or an unwritable logs/ directory would throw, propagate to main().catch(), and fail the entire brief run with ok:false — even when every actual source succeeded. This violates CLAUDE.md's Error Handling rule (every tool fails independently) and the slice's own AC1. Found during compliance/craft review of slice 003-03. Fixed by making both functions catch their own read/parse/write errors internally (console.error('[brief]', ...)) and always return a usable state object instead of throwing. Contrast with scripts/lib/ai-radar/state.js, whose loadSeenCache still throws on a non-ENOENT read error — that module is a single dedup cache read once at the top of a source-specific fetch, not a whole-run dependency, so the risk profile differs. Rule of thumb: any state/cache file read or written on the hot path of a multi-source run must never let an I/O/parse failure escalate past its own boundary.
