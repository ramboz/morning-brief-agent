---
name: morning-outlook
description: Outlook/Teams sub-agent — three-step workflow (gather via connector/browser, triage emails, stage draft replies via Claude in Chrome). Supports Morning Brief and Deep Dive modes.
allowed-tools: bash, computer
---

# Morning Outlook

## Load config

Read: `~/.claude/skills/morning-outlook/config/outlook-rules.json`

Extract: `auto_archive`, `auto_delete`, `draft_tone`, `outlook_url`.

---

## Morning Brief Mode

### Step 1 — GATHER (fast)

**If gather_method = "connector":** Use the Cowork M365 connector to fetch:
- Inbox emails within lookback window (sender, subject, preview, TO/CC)
- Teams activity feed (mentions, thread replies)

**If gather_method = "browser" (fallback):** Navigate to Outlook Web App via Claude in Chrome. Check for login. Scan inbox, open each email to read sender/subject/body. Check Teams activity feed.

**Limit to 50 emails.** If more, note truncation.

### Step 2 — ANALYZE (fast)

**Triage each email** into one of:

| Category | Action | Draft? |
|---|---|---|
| `action_required` | Keep in inbox | Yes (if reply expected) |
| `fyi` | Keep in inbox | No |
| `newsletter` | Archive (if auto_archive) | No |
| `marketing` | Archive (if auto_archive) | No |
| `automated_alert` | Archive (if auto_archive) | No |
| `junk` | Flag for deletion (never auto-delete) | No |

**Conservative default:** When in doubt → `fyi`. Never auto-archive anything ambiguous.

For `action_required`: Is a reply expected? Is user in TO (not just CC)?

**Archive noise** (if `auto_archive: true`): For newsletters, marketing, and automated alerts, archive via the tool's Archive action. **Never permanently delete.**

**Teams activity:** Surface @mentions and thread replies. Note who, what channel, what they said.

**Identify draft targets:** `action_required` emails where a reply is clearly expected and user is directly addressed.

### Step 3 — DRAFT (slow, targeted — if draft_enabled)

For each draft target, use Claude in Chrome:

1. Open the email in Outlook Web App
2. Click the Reply button
3. Wait for the compose window
4. Click into the compose body
5. Type a draft reply
6. **STOP — do NOT click Send**

**Draft guidance:**
- Address the specific question or request
- Acknowledge deadlines if mentioned
- If insufficient context: "Thanks for your email — I'll get back to you on this shortly."
- Sign off: "Best,\n[Your name]"
- 3-5 sentences unless clearly more needed
- Never fabricate facts

**Do NOT draft for:** CC-only emails, meeting invitations, emails requiring non-email action.

### Output

Return to orchestrator:
- Daily note section (formatted markdown)
- Draft targets list
- Auto-archive count by category

### Daily note section format

```markdown
### Action Required
- 🔴 **VP Engineering** — Q2 budget review, due Friday → [Draft staged]
- 🔴 **Alice Chen** — PR #482 merge conflict → [Draft staged]

### FYI / Reading
- ℹ️ **Platform Team** — New CI/CD pipeline docs
- ℹ️ **HR** — Updated remote work policy, effective April 1

### Auto-Archived (12)
- 8 build alerts, 3 newsletters, 1 calendar update

### 💬 Teams Activity
- **#architecture-council** — Mentioned in API versioning discussion
- **Meeting follow-up** — Action items from yesterday's standup

### Staged Drafts (2)
1. Reply to VP Engineering → Budget review acknowledgment
2. Reply to Alice Chen → Merge conflict resolution
```

---

## Deep Dive Mode

Answer the user's question about email or Teams. No draft staging unless asked.

**gather_method = "connector":** Use M365 connector with search filters (sender, keyword, date).
**gather_method = "browser":** Navigate to Outlook search, enter keywords and date filters.

Return a direct, conversational answer with relevant excerpts.

---

## Error handling

| Scenario | Action |
|---|---|
| Connector unavailable | Try browser fallback, then report error |
| Login screen | Stop, report "Outlook requires login" |
| Archive action fails | Log, continue with other emails |
| Compose window doesn't open | Skip draft, log, continue |
| Teams not accessible | Skip Teams section, note in brief |
