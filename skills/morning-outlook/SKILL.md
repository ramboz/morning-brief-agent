---
name: morning-outlook
description: Outlook/Teams sub-agent — three-step workflow (gather via connector/browser, triage emails, stage draft replies via Claude in Chrome). Supports Morning Brief and Deep Dive modes.
allowed-tools: bash, computer
---

# Morning Outlook

## Load config

Read: `{scripts_path}/../config/outlook.json`

Extract: `auto_archive`, `auto_delete`, `draft_tone`, `outlook_url`.

---

## Morning Brief Mode

### Step 1 — GATHER (fast)

**Primary method — Graph API script:**

```bash
node scripts/fetch-outlook.js --brief
```

This returns structured JSON with:
- `emails` — inbox messages within lookback window (triaged: action_required, fyi, newsletter, marketing, automated_alert, junk)
- `calendar` — today's events with Teams meeting flags
- `transcripts` — recent meeting transcript files (.vtt) found via SharePoint search
- `triageSummary` — counts per triage category
- `emailsTruncated` — true if >50 emails in window

**Fallback — Cowork M365 connector:** If the script fails (auth expired, VPN required), use the M365 connector to fetch inbox emails and Teams activity.

**Last resort — browser:** Navigate to Outlook Web App via Claude in Chrome. Scan inbox manually.

**Step 1b — Summarize meeting transcripts (if any found):**

If `fetch-outlook.js` returned any items in `transcripts`, run:

```bash
CLAUDE_BIN=$(which claude) node scripts/summarize-meeting.js --brief
```

This downloads each `.vtt` transcript from SharePoint, summarizes it with Claude, and writes a meeting note to `{vault_path}/Meetings/YYYY-MM-DD-{meeting-title}.md`. It returns structured JSON with:
- `meetings` — list of summarized meetings (title, date, key decisions, action items, attendees, vault_path)
- `skipped` — transcripts skipped (already summarized, too old, or download failed)

If `CLAUDE_BIN` is not found via `which claude`, check `~/.local/bin/claude` or `/usr/local/bin/claude`. If unavailable, skip transcript summarization and note it in the brief.

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

**Deep-link EVERY email** — each email item MUST include a clickable link using the `url` field from the script output. Format: `[Subject or sender](url)`.

```markdown
### Action Required
- 🔴 **[VP Engineering — Q2 budget review](https://outlook.office.com/mail/inbox/id/...)** — due Friday → [Draft staged]
- 🔴 **[Alice Chen — PR #482 merge conflict](https://outlook.office.com/mail/inbox/id/...)** → [Draft staged]

### FYI / Reading
- ℹ️ **[Platform Team — New CI/CD pipeline docs](https://outlook.office.com/mail/inbox/id/...)**
- ℹ️ **[HR — Updated remote work policy](https://outlook.office.com/mail/inbox/id/...)** — effective April 1

### Auto-Archived (12)
- 8 build alerts, 3 newsletters, 1 calendar update

### 📅 Calendar
| Time | Meeting | Notes |
|---|---|---|
| 15:00 | Sync on auto-optimize | Mihai Corlan [Teams](teams-url) |

### 💬 Teams Activity
- **#architecture-council** — Mentioned in API versioning discussion
- **Meeting follow-up** — Action items from yesterday's standup

### 🎙️ Meeting Summaries
- **[[Meetings/2026-03-27-sync-on-auto-optimize|Sync on auto-optimize]]** — 3 action items · [[Meetings/2026-03-27-sync-on-auto-optimize|→ Full notes]]
- **[[Meetings/2026-03-27-personalization-tech-sync|Personalization tech sync]]** — 2 decisions · [[Meetings/2026-03-27-personalization-tech-sync|→ Full notes]]

### Staged Drafts (2)
1. Reply to VP Engineering → Budget review acknowledgment
2. Reply to Alice Chen → Merge conflict resolution
```

Omit the "Meeting Summaries" section if no transcripts were found or summarized. Each entry links to the Obsidian meeting note using the `vault_path` returned by `summarize-meeting.js`.

If `transcripts` is empty but `recordings` is non-empty, skip Step 1b (no VTT to summarize) and instead render a **Meeting Recordings** section:

```markdown
### 🎬 Meeting Recordings (yesterday)
- **[2xWeekly]ASO Auto-Optimize Check-In** — [Watch recording](https://adobe-my.sharepoint.com/...) *(transcript unavailable — not organizer)*
- **[Weekly] ASO ESE/Engineering Sync** — [Watch recording](https://adobe-my.sharepoint.com/...) *(transcript unavailable — not organizer)*
```

Use the `webUrl` field from each recording object as the link. Note that auto-summarization is unavailable for these — the user must watch the recording manually.

**Calendar timezone:** The script outputs calendar times already converted to local timezone (from `timezone` in `outlook.json`). Display times as-is — do NOT convert again.

---

## Deep Dive Mode

Answer the user's question about email or Teams. No draft staging unless asked.

**Primary method — Graph API script:**

```bash
node scripts/fetch-outlook.js --search "query terms"
```

Returns emails, SharePoint files, and transcript matches.

**Fallback:** M365 connector with search filters, or browser search.

Return a direct, conversational answer with relevant excerpts.

---

## Error handling

| Scenario | Action |
|---|---|
| Script auth expired | Re-run `node scripts/diag-outlook.js` to re-authenticate, then retry |
| Connector unavailable | Try browser fallback, then report error |
| Login screen | Stop, report "Outlook requires login" |
| Archive action fails | Log, continue with other emails |
| Compose window doesn't open | Skip draft, log, continue |
| Teams not accessible | Skip Teams section, note in brief |
