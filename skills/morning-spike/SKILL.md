---
name: morning-spike
description: Phase 0 validation spike — 12 pass/fail tests covering API access, browser draft staging, sub-agent spawning, and infrastructure before running the full agent
allowed-tools: bash, computer
---

# Morning Assistant — Phase 0 Validation Spike

Run these tests one at a time. Report **PASS** or **FAIL** for each. Stop after any critical FAIL and report before continuing.

---

## API / Connector Validation (Tests 1–5)

### Test 1 — Slack Connector or API

**Goal:** Confirm data can be gathered from Slack without browser automation.

Try the Cowork Slack connector first. If unavailable, test the script fallback:

```bash
node {scripts_path}/fetch-slack.js --brief
```

**PASS** if the connector returns channel data, or the script returns `ok: true` with messages.
**FAIL** if no Slack data path works. Note which method was attempted.

### Test 2 — GitHub Connector or API

**Goal:** Confirm GitHub.com notifications can be fetched.

Try the Cowork GitHub connector first. If unavailable:

```bash
node {scripts_path}/fetch-github-com.js --brief
```

**PASS** if notifications data is returned (even if 0 notifications — that's valid).
**FAIL** if authentication fails or no data path works.

### Test 3 — JIRA DC REST API

**Goal:** Confirm the JIRA DC API responds with ticket data.

```bash
node {scripts_path}/fetch-jira.js --brief
```

**PASS** if `ok: true` with ticket data (or empty results — that's valid).
**FAIL** if `ok: false` with connection/auth errors. Check VPN and `.env` values.

### Test 4 — Confluence DC REST API

**Goal:** Confirm the Confluence DC API responds with page data.

```bash
node {scripts_path}/fetch-confluence.js --brief
```

**PASS** if `ok: true` with page data.
**FAIL** if `ok: false`. Check VPN and `.env` values.

### Test 5 — Outlook (M365 Connector or Browser)

**Goal:** Test Outlook data access.

Try the Cowork M365 connector first. If unavailable, test browser fallback:
Navigate to `https://outlook.office.com` via Claude in Chrome and confirm you can read the inbox.

**PASS** if either connector or browser returns email subjects.
**FAIL** if neither path works. Note which was attempted.

---

## Browser Validation (Tests 6–8)

### Test 6 — Slack Compose Without Send

**Goal:** Confirm Claude in Chrome can type into Slack's compose box without sending.

1. Navigate to Slack (`https://app.slack.com`) via Claude in Chrome
2. Go to any channel
3. Click into the compose box
4. Type: "spike test — do not send"
5. **DO NOT press Enter or click Send**
6. Confirm the text appears in the compose box

**PASS** if text appears and was NOT sent.
**FAIL** if compose box not found, text doesn't appear, or message gets sent.
**CRITICAL FAIL** if the message is sent — stop immediately, report the safety constraint violation.

After PASS: clear the compose box (press Escape or select-all and delete).

### Test 7 — Outlook Compose Without Send

**Goal:** Confirm Claude in Chrome can type into Outlook's reply compose without sending.

1. Navigate to Outlook Web App
2. Open any email
3. Click Reply
4. In the compose window, type: "spike test — do not send"
5. **DO NOT click Send**
6. Confirm the text appears in the compose body

**PASS** if text appears and was NOT sent.
**FAIL** if compose window doesn't open or text doesn't appear.

After PASS: close the reply without sending (click Discard or press Escape).

### Test 8 — JIRA Comment Without Submit

**Goal:** Confirm Claude in Chrome can type into JIRA's comment box without submitting.

1. Navigate to any JIRA ticket
2. Find the "Add a comment" box
3. Click to activate it
4. Type: "spike test — do not submit"
5. **DO NOT click Save or Submit**
6. Confirm the text appears in the comment box

**PASS** if text appears and was NOT submitted.
**FAIL** if comment box not found or text doesn't appear.

After PASS: clear the text or close the comment editor.

---

## Infrastructure Validation (Tests 9–12)

### Test 9 — Sub-Agent Spawning

**Goal:** Confirm Cowork can spawn at least 2 sub-agents that execute independently.

Spawn two sub-agents simultaneously:
- Sub-agent A: "Return the text 'AGENT-A-OK'"
- Sub-agent B: "Return the text 'AGENT-B-OK'"

**PASS** if both return their respective text.
**FAIL** if sub-agent spawning fails or only one executes.

Note whether they ran in parallel or sequentially.

### Test 10 — File Write to Obsidian Vault

**Goal:** Confirm the agent can write a file to the vault path.

Read `vault_path` and `daily_notes_folder` from config, then:

```bash
node -e "
import { writeFile, mkdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
const vault = '<vault_path>';
const folder = '<daily_notes_folder>';
const dir = join(vault, folder);
await mkdir(dir, { recursive: true });
const f = join(dir, 'spike-test.md');
await writeFile(f, '# Spike Test\n\nWritten by Phase 0 validation. Safe to delete.\n');
console.log('Written: ' + f);
await unlink(f);
console.log('Cleaned up.');
"
```

**PASS** if file is written and cleaned up without errors.
**FAIL** if path not found or permissions error.

### Test 11 — Helper Script Invocation

**Goal:** Confirm Cowork can invoke a Node.js script and parse its stdout.

```bash
node {scripts_path}/fetch-jira.js --brief
```

Parse the JSON output. Verify the envelope structure: `ok`, `tool`, `mode`, `timestamp`, `data`, `errors`.

**PASS** if JSON is parseable and has the correct envelope structure.
**FAIL** if the script errors, stdout is not valid JSON, or envelope is malformed.

### Test 12 — Scheduled Task (Optional)

**Goal:** Confirm a Cowork scheduled task can trigger the morning brief.

Create a test scheduled task that runs in 2 minutes. Verify it fires.

**PASS** if the task triggers.
**FAIL** if scheduled tasks are not supported.
**SKIP** if not needed yet — mark as N/A.

---

## Final Report

```
Phase 0 Validation Results — Cowork Hybrid Architecture
=========================================================

API / Connector:
  Test 1  — Slack:            PASS / FAIL  (method: ___)
  Test 2  — GitHub.com:       PASS / FAIL  (method: ___)
  Test 3  — JIRA DC API:      PASS / FAIL
  Test 4  — Confluence DC API: PASS / FAIL
  Test 5  — Outlook:          PASS / FAIL  (method: ___)

Browser Draft Staging:
  Test 6  — Slack compose:    PASS / FAIL
  Test 7  — Outlook compose:  PASS / FAIL
  Test 8  — JIRA comment:     PASS / FAIL

Infrastructure:
  Test 9  — Sub-agent spawn:  PASS / FAIL  (parallel: yes/no)
  Test 10 — Vault file write: PASS / FAIL
  Test 11 — Script invoke:    PASS / FAIL
  Test 12 — Scheduled task:   PASS / FAIL / N/A

Overall: READY TO PROCEED / BLOCKED (reason: ___)
```

**Pass criteria:**
- All API/connector tests (1-5) pass via at least one method each
- At least Slack + one other tool pass browser draft staging (6-8)
- Sub-agents work (9), even if sequential
- File write works (10)
- Script invocation works (11)
- Scheduled task (12) can be deferred
