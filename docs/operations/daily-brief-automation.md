# Daily Brief Codex Automation

Codex automations are the scheduled-run mechanism for Morning Assistant v2. The
automation runs the existing manual brief command instead of adding a separate
repo-owned scheduler.

## Workspace

Use the long-lived repository workspace:

```text
/Users/ramboz/Projects/misc/morning-brief-agent
```

## Reviewable Configuration

The automation was proposed through the Codex automation tool for user review on
2026-06-19. It was not hand-written as a raw scheduler directive.

- **Name:** Morning Assistant Daily Brief
- **State:** proposed for user approval
- **Execution environment:** local
- **Workspace:** `/Users/ramboz/Projects/misc/morning-brief-agent`
- **Schedule:** weekdays at 7:30 AM America/Los_Angeles
- **Reasoning effort:** medium
- **Model:** app-selected GPT-5.4

Codex stores the schedule and workspace as structured automation fields. The
reviewable scheduled-run packet is self-contained across those fields and the
task prompt below.

## Task Prompt

Use this automation prompt:

```text
Run the Morning Assistant Daily Brief for workspace
`/Users/ramboz/Projects/misc/morning-brief-agent`.

In the configured workspace, execute `npm run brief`.

Confirm the command returns a JSON envelope. If `ok` is true, report the Daily
Brief date, the dated Markdown path, the latest Markdown path, and any source
warnings or source errors from the envelope.

If the command fails, times out, returns invalid JSON, or returns an envelope
with `ok` false or non-empty top-level errors, report the failure clearly in the
automation result with the command output or envelope errors. Do not send
messages, stage replies, mutate external tools, or make unrelated repository
changes during a scheduled run.
```

## Failure Behavior

The first scheduled shell reports failures in the Codex automation result. It
does not try to send notifications or write durable per-source failure state.
Spec `003-03` owns durable failure state and hung-source isolation.
