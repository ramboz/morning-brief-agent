---
name: morning-topic-status
description: Topic-scoped daily status update — focused brief covering one track (e.g. "CWV in ASO") drawn from a custom JIRA JQL and a list of Slack channels. Read-only, no draft staging. Writes a Markdown note to the Obsidian vault.
allowed-tools: bash
---

# Morning Topic Status

Produce a daily, narrative status update for ONE topic — a focused area of work defined by a custom JIRA JQL plus a list of Slack channels. Examples: "CWV in ASO", "Auth migration", "Q2 platform initiatives". This is **read-only by design** — no drafts, no replies, no posting.

When the user invokes this skill, expect a request like:
- "Run my CWV/ASO status update"
- "Topic status: cwv-aso"
- "What moved on CWV in ASO today?"
- "CWV status for the last 7 days"

---

## Step 0 — Load main config

Read: `{scripts_path}/../config/main.json`

Extract: `vault_path`, `daily_notes_folder`, `scripts_path`, `lookback_hours` (default 24).

If missing, stop:
> Config not found. Copy `main.example.json` to `main.json` and fill in your settings.

---

## Step 1 — Resolve the topic

Read: `{scripts_path}/../config/topics.json`

Extract `topics` map keyed by topic id.

If missing, stop:
> Topics config not found. Copy `topics.example.json` to `topics.json` and define your topics.

**Pick the topic id from the user's request:**
- Explicit: "topic status: cwv-aso" → `cwv-aso`
- Inferred from `name` field: "CWV/ASO status" → match against any topic where the name or id matches "cwv" + "aso"
- Ambiguous: list all available topics (`Object.keys(topics).join(', ')`) and ask which one

If the topic id is unknown, list available topics and ask the user — never guess.

**Each topic config has:**
- `name` — human-readable label (used in the note title)
- `jira.jql` — the raw JQL string (no time bound; this skill adds it)
- `jira.search_url` — optional, link to the JIRA web search for this JQL (footer "drill-down" link)
- `slack.channels` — array of Slack channel IDs (e.g. `["C08A1K0U74P"]`)
- `lookback_hours` — optional, overrides the global lookback for this topic

**Resolve the lookback window:**
- User specified ("last 7 days", "this week") → use that
- Else: topic `lookback_hours` → main `lookback_hours` → 24h default

---

## Step 2 — Construct bounded JQL

The topic's `jira.jql` is the scope. AND-in the time bound and re-add an `ORDER BY` clause.

1. Take `topic.jira.jql` as the base string.
2. If it contains a trailing `ORDER BY ...` clause, strip it.
3. Wrap in parens to keep any internal `OR`s scoped: `(${baseJql})`.
4. AND-in time bound: `(${baseJql}) AND updated >= -${hours}h`.
5. Append: ` ORDER BY updated DESC`.

Example final JQL:
```
(project in (SITES, ASO) and (component in componentsWithString("cwv") or labels in (cwv, Opy-CWV))) AND updated >= -24h ORDER BY updated DESC
```

---

## Step 3 — Gather data in parallel

Spawn both fetchers concurrently. Each is independently fault-tolerant — if one fails, render the surviving section + an inline error note for the failed one.

### JIRA

```bash
node {scripts_path}/fetch-jira.js --jql "<bounded JQL>"
```

Parse the JSON envelope. Expected shape:
```json
{
  "ok": true,
  "tool": "jira",
  "mode": "jql",
  "data": {
    "issues": [
      { "key": "...", "summary": "...", "status": "...", "priority": "...", "assignee": "...", "labels": [...], "updatedAt": "...", "url": "...", "recentComments": [...] }
    ],
    "truncated": false
  }
}
```

If `ok: false`, capture the error string for the JIRA section header.

### Slack

Use a **wider lookback** than the topic's nominal window — typically 168h (7 days) — so the fetcher catches parent messages of threads that have recent replies. Without this, threads whose parent is older than the window are invisible even if today's discussion is happening inside them.

```bash
node {scripts_path}/fetch-slack.js --channels <id1,id2,...> --lookback 168
```

The `--channels` mode automatically fetches all thread replies for top-level messages with `replyCount > 0`, and includes the user's own messages (the user's replies are often where ETAs and decisions live). Parse the JSON envelope:

```json
{
  "ok": true,
  "tool": "slack",
  "mode": "channels",
  "data": {
    "channels": [
      { "id": "...", "name": "...", "url": "...", "messages": [
        {
          "ts": "...",
          "user": { "name": "..." },
          "text": "...",
          "permalink": "...",
          "replyCount": N,
          "reactions": [...],
          "threadReplies": [
            { "ts": "...", "user": { "name": "..." }, "text": "...", "permalink": "..." }
          ]
        }
      ] }
    ]
  }
}
```

**Mine the threads, not just the top-level.** The substantive signal — ETAs, decisions, blockers, agreements — almost always lives in `threadReplies`, not in the parent message. After parsing:

1. Flatten all top-level messages + their `threadReplies` into a single chronological event list.
2. Filter to events with `ts >= now - topic_lookback_hours` (the topic's actual window — narrower than the fetch window).
3. Use that filtered list as the basis for the bullets.

A channel with an `error` field means the bot couldn't read it (not a member, archived, etc.).

---

## Step 4 — Synthesize the narrative

**Output is Slack-message length: a one-line headline + 3–5 ranked bullets + a one-line footer.** This is a scannable daily ping, not a deep-dive report. If you find yourself writing sub-headings, sub-quotes, or grouping bullets into categories, you're writing too much — collapse it.

### Format (exact)

```
**Headline** — one sentence, the single most important thing that moved (or didn't).

- 🔴/🟡/ℹ️ [KEY or thread link](url) — what happened, why it matters, what's needed (1–2 sentences max).
- ...3 to 5 bullets total...

[JIRA query](search_url) · [#channel](channel-url) · {N}h · {HH:MM} {TZ}
```

### Bullet ranking (highest priority first)

1. Things needing the user's input or attention (status flips on critical work, direct questions, stalled items)
2. Significant engineering motion (PRs merged/blocked, status changes that reflect real progress)
3. Cross-cutting context (triage waves, dup consolidation, decisions that affect future work)
4. Slack-only signal (substantive thread or "channel was quiet")

If a bullet would just say "X was updated" with no information beyond the metadata change, **drop it**. The bullet must answer "so what?"

### Severity emojis

- 🔴 — needs your input / blocking / critical & stalled
- 🟡 — significant motion or decision worth knowing about
- ℹ️ — context / FYI / aggregate signal

### Synthesis rules

- **Bullets are sentences, not labels.** "🔴 SITES-37871 is stalled" is wrong. "🔴 [SITES-37871](url) (Critical) — filter-out-green decision is 27 days old, both PRs still open" is right.
- **Map commitments to specific tickets/PRs, not broad workstreams.** When a Slack message mentions an ETA for "bug fixes" or "the refactor" or "the migration", drill into the channel's older threads to find the source-of-truth task list (these are usually the parent thread of a "where are we?" Q&A, often days or weeks old). Cite the specific ticket keys and PR numbers in the bullet — never leave the reader to guess which tickets the ETA covers. If no ticket exists yet for a workstream, say so explicitly: "**No JIRA ticket yet** — driven by [PR](url)".
- **Combine signals.** A wave of duplicate-closures from one triage pass is one bullet, not four.
- **Drop noise.** Pure metadata edits (label tweaks, dup-link adds) only earn a bullet if they aggregate into a meaningful pattern.
- **Quote only when irreplaceable.** If a one-line paraphrase loses the key detail, then quote — otherwise paraphrase.
- **Names and links are non-negotiable.** Every JIRA reference is a `[KEY](url)` link; every Slack mention includes the `permalink`.
- **Don't fabricate** — if motion is unclear, say so or omit. Don't invent rationale.
- **Don't sycophant** — no "great progress!" framing. Plain reporting.
- **Slack-quiet is a one-liner**, not a section: "Slack: quiet (0 messages in #aem-sites-optimizer-cwv)" embedded in a bullet or in the footer is enough.

---

## Step 5 — Write to vault

Path: `{vault_path}/{daily_notes_folder}/{YYYY-MM-DD}-{topic-id}-status.md`

Use this template (matching the daily brief's `<!-- AGENT:* -->` anchor convention so re-runs preserve any user edits between or outside anchors):

```markdown
# {topic.name} — {YYYY-MM-DD}

<!-- AGENT:brief -->
**{Headline — one sentence}**

- {emoji} {bullet 1}
- {emoji} {bullet 2}
- {emoji} {bullet 3}
- {emoji} {bullet 4 — optional}
- {emoji} {bullet 5 — optional, hard cap}

[JIRA query]({search_url}) · [#{channel-name}]({channel-url}) · {N}h · {HH:MM} {TZ}
<!-- /AGENT:brief -->
```

**That's the whole file.** No additional sections, no blockers section, no per-tool grouping. The bullets do all the work.

**Smart re-run:** If the file already exists, replace only content between matching `<!-- AGENT:brief -->` anchors. Preserve any user notes added outside anchors.

**Empty windows:** If neither JIRA nor Slack had substantive activity, write a single bullet: `- ℹ️ Quiet window — no notable JIRA updates, no Slack activity.` Then footer. That's it.

---

## Step 6 — Report to user

Print to Cowork chat:
- The vault path (clickable if Cowork supports it)
- A one-line summary: `Wrote {filename} — {N} JIRA updates, {N} Slack messages across {N} threads.`
- Tools that failed (if any), with the error reason: `_JIRA: unreachable — are you on VPN?_`

---

## Error handling

| Scenario | Action |
|---|---|
| Topic id unknown | List available topics, ask which one |
| JIRA fetcher returns `ok: false` | Render Slack section + inline JIRA error note |
| Slack fetcher returns `ok: false` | Render JIRA section + inline Slack error note |
| Both fail | Write a stub note explaining both failures; still create the file so the failure is auditable |
| Slack channel returns `error` field (bot not in channel) | Note the failure inline; don't abort other channels |
| Malformed user JQL (JIRA 400) | Surface the JIRA error string in the JIRA section header |
| Lookback window is 0 or negative | Use 24h default, log a warning |

---

## Safety constraints — NON-NEGOTIABLE

1. **Read-only.** Never post to JIRA, Slack, or any tool.
2. **No draft staging.** This skill writes only to the Obsidian vault — nothing else.
3. **No data exfiltration.** Don't share JIRA ticket details or Slack messages outside the vault file or the Cowork chat session.
4. **Trust the JQL.** The user's JQL is theirs to author — don't rewrite it for "safety". Do add the time bound (Step 2) but don't otherwise modify it.
5. **Fail visibly.** If a fetcher errors, write the error into the note. Silent failures are worse than loud ones.
