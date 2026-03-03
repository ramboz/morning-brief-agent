# Spec 04 — Slack

## Overview

Fetch Slack activity from the last 24h across the user's priority channels (defined in a config file), direct messages, any channel where the user was mentioned, and threads the user participated in that have new replies. Summarize using Claude and render into the Obsidian daily note. Read-only — the script never posts to Slack.

The guiding philosophy: surface **where the user needs to show up today**, not just what happened. User's own messages are filtered from channel summaries — the sections show what the organization is discussing, not what the user already said.

---

## Library

`@slack/web-api` — official Slack Web API client for Node.js

```js
import { WebClient } from '@slack/web-api'
const slack = new WebClient(process.env.SLACK_USER_TOKEN)
```

---

## Authentication

### Token Type: User Token (xoxp-)

Use a **user token**, not a bot token. This is important because:
- Bot tokens can only see channels the bot is invited to
- User tokens act as the authenticated user and can read all channels the user is a member of
- DMs are only accessible via user token

### Creating the Slack App

1. Go to https://api.slack.com/apps → **Create New App** → **From scratch**
2. Name: `morning-briefing` — Workspace: select your work workspace
3. Navigate to **OAuth & Permissions**
4. Under **User Token Scopes** (not Bot Token Scopes), add:

```
channels:history      — read messages in public channels
groups:history        — read messages in private channels
im:history            — read direct messages
mpim:history          — read group direct messages
channels:read         — list public channels + membership
groups:read           — list private channels + membership
im:read               — list DMs
mpim:read             — list group DMs
users:read            — resolve user IDs to display names
reactions:read        — read reactions (for context scoring)
```

5. **Install App to Workspace** — if workspace requires admin approval, submit the request. The scopes above are all read-only user scopes; most admins approve these quickly.
6. After installation, copy the **User OAuth Token** (starts with `xoxp-`) to `.env`

### Environment Variable

```
SLACK_USER_TOKEN=xoxp-...
SLACK_CONFIG_PATH=./config/slack.json
```

---

## Channel Priority Configuration

Channel prioritization is defined in `config/slack.json` (`SLACK_CONFIG_PATH` env var). This is a flat list of channels to monitor — only these channels get full history and AI summaries. Everything else is checked for mentions only.

### Format

```json
{
  "channels": [
    "#eng-general", "#eng-backend", "#incidents", "#deployments",
    "#product", "#roadmap", "#design-feedback",
    "#general", "#announcements"
  ]
}
```

- Channel names with or without `#` prefix — normalized on load
- Channels not listed here are "other channels" — checked for mentions only
- The file is gitignored if it contains sensitive channel names, but can be committed if preferred — user's choice

### Config Loading

```js
async function loadConfig(slack) {
  // Read config/slack.json
  // Resolve channel names to IDs using conversations.list
  // Return: { ok: true, channels: [{ id, name }] }
}
```

Channel name→ID resolution happens once at startup and is reused throughout the run.

---

## Data Fetching Strategy

With 100+ channels, fetching all history naively would be extremely slow and hit rate limits. Use this strategy:

### Step 1: Get all channel IDs the user is a member of
```
users.conversations({ types: 'public_channel,private_channel', exclude_archived: true })
```
Paginate until all channels are retrieved. This endpoint returns only channels the user is a member of — no `is_member` filtering needed. Call this once and reuse the list for `loadConfig` and `countOtherChannelActivity`.

### Step 2: Fetch mentions across ALL channels (efficient path)
Use the search API to find all messages mentioning the user in the last 24h:
```
search.messages({ query: '<@{userId}>', count: 100 })
```
This is a single API call covering all channels. Requires the user token.

### Step 3: Fetch full history only for priority channels
For each channel in `config/slack.json`, fetch messages since `since`. Filter out the user's own messages before returning — sections show what the org is discussing, not what the user already said:
```
conversations.history({ channel: channelId, oldest: since.unix(), limit: 200 })
```
Also fetch thread replies for any threads with activity:
```
conversations.replies({ channel: channelId, ts: threadTs, oldest: since.unix() })
```

### Step 3b: Fetch thread updates
Find threads the user previously replied to that have new replies from others:
1. Search `from:<@userId>` to find messages the user posted in threads
2. For each that was a thread reply (thread_ts ≠ ts), fetch `conversations.replies` for that thread
3. Find replies from others that came after the user's last reply in that thread
4. Skip threads where the user has the last word (nothing new to catch up on)

### Step 4: Fetch DMs
```
conversations.list({ types: 'im,mpim' })
```
Then `conversations.history` for each DM with unread messages since `since`.

### Step 5: Resolve user IDs to display names
Cache `users.info({ user: userId })` calls — many messages will share the same users. Use a simple in-memory Map as a cache.

---

## Rate Limiting

Slack's Web API has a Tier system. Key limits:
- `conversations.history`: Tier 3 — ~50 requests/min
- `search.messages`: Tier 2 — ~20 requests/min
- `users.info`: Tier 4 — ~100 requests/min

With 100+ channels, fetching history for ALL of them would hit rate limits. **Only fetch full history for priority channels** (those in `config/slack.json`). For all other channels, rely on the search API for mention detection only.

Implement a simple rate limit helper:
```js
// Wait ms milliseconds
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

// Between consecutive conversations.history calls, wait 1200ms
// (50 requests/min = 1 per 1.2 seconds)
```

---

## Data Shape Returned by fetchSlack()

```js
{
  ok: true,
  data: {
    mentions: [
      {
        channelId: "C012AB3CD",
        channelName: "eng-general",
        ts: "1709298180.000200",
        user: { id: "U012AB3CD", name: "Alice Chen" },
        text: "hey <@UXXXXXXXX> can you review PR #482?",
        threadTs: null,   // null if not in a thread
        permalink: "https://yourworkspace.slack.com/archives/C012AB3CD/p1709298180000200"
      }
    ],
    threadUpdates: [
      {
        channelId: "C012AB3CD",
        channelName: "eng-backend",
        threadTs: "1709200000.000100",
        parentText: "Should we use optimistic locking for the cart update endpoint?",
        newReplies: [
          {
            ts: "1709298100.000300",
            user: { id: "U012AB3CD", name: "Alice Chen" },
            text: "I think we need to revisit this — had a production issue with it last month"
          }
        ],
        totalNewReplies: 2
      }
    ],
    directMessages: [
      {
        dmId: "D012AB3CD",
        withUser: { id: "U012AB3CD", name: "Bob Smith" },
        messages: [
          {
            ts: "1709298180.000200",
            isFromMe: false,
            user: { id: "U012AB3CD", name: "Bob Smith" },
            text: "Hey, can we sync tomorrow?"
          }
        ]
      }
    ],
    channels: [
      {
        id: "C012AB3CD",
        name: "eng-general",
        messages: [
          // User's own messages are excluded — only others' messages
          {
            ts: "1709298180.000200",
            user: { id: "U012AB3CD", name: "Alice Chen" },
            text: "Deployed v2.4.1 to production ✅",
            replyCount: 3,
            reactions: [{ name: "white_check_mark", count: 4 }]
          }
        ],
        threadReplies: []
      }
    ],
    otherChannelsActivity: {
      totalChannelsWithActivity: 12,
      mentionCount: 0
    }
  }
}
```

---

## Summarization (in src/ai/summarize.js)

### summarizeSlackMentions(mentions)
For each @mention, produce a one-line summary of what was asked or notified and whether a reply seems expected.

### summarizeSlackDMs(directMessages)
For each DM thread, produce a 1-2 sentence summary and flag if a reply from the user seems expected.

### summarizeSlackThreads(threadUpdates)
For each thread the user was part of, summarize the new replies from others and determine whether a follow-up is expected. Only threads where others have replied after the user's last message are included — the user already has the last word is not surfaced.

### summarizeSlackChannels(channels)
For all priority channels, identify discussions where the user should consider engaging today:
- Open questions or debates where their expertise or opinion would be valuable
- Architecture or technical decisions being made without a clear conclusion
- Customer feedback or incidents being discussed
- Decisions in progress that affect the user's work
- Announcements they should be aware of

Skip: trivial chatter, fully resolved discussions, status updates requiring no action, bot messages unless incident/alert/error.

Note: user's own messages are already filtered from channel data before this function is called — summaries reflect what the org is discussing, not the user's own contributions.

---

## Daily Note Rendering

```markdown
## 💬 Slack
### 🔴 Mentions & Threads
- 🔴 **#eng-general** — Alice Chen asked you to review PR #482 *(2h ago)*
- 🔴 **#incidents** — You were tagged in the P1 incident thread *(5h ago)*

### Thread Updates
- ℹ️ **#eng-backend** — Should we use optimistic locking?
  Alice and Bob pushed back on the approach — waiting for your thoughts.

### Direct Messages
- **Bob Smith** — Wants to sync tomorrow. Reply expected. *(3h ago)*
- **Carol Wu** — Sent the Q1 budget doc for your review. *(7h ago)*

### Priority Channels
#### #eng-general
- Discussion on migrating to Postgres 16 — no decision yet, Alice asked for input
- Increased latency on checkout API flagged — may be the new caching layer

#### #incidents
- P1 incident resolved after 2h. Post-mortem scheduled for Thursday.

#### #roadmap
- Q2 priorities under discussion — mobile feature timeline unclear, decision pending

### Other Channels
_12 channels had activity. No mentions._
```

Anchor comments for smart merge:
```
<!-- AGENT:slack_mentions -->
<!-- AGENT:slack_threads -->
<!-- AGENT:slack_dms -->
<!-- AGENT:slack_channels -->
<!-- AGENT:slack_other -->
```

---

## Error Handling

| Scenario | Behaviour |
|---|---|
| `SLACK_USER_TOKEN` missing | Return `{ ok: false, error: 'SLACK_USER_TOKEN not set' }` |
| Token invalid / revoked | Return `{ ok: false, error: 'Slack auth failed — check token' }` |
| `config/slack.json` missing | Log warning, skip channel summaries, still fetch mentions and DMs |
| `config/slack.json` has unknown channel name | Log warning for that channel, skip it, continue |
| Rate limit hit (HTTP 429) | Read `Retry-After` header, sleep, retry once |
| Individual channel history fails | Log warning, skip that channel, continue |
| Search API fails | Log warning, fall back to mention detection within priority channel history only |
| DM fetch fails | Log warning, skip DMs section |

---

## Standalone Runner

```js
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const result = await fetchSlack(since)
  console.log(JSON.stringify(result, null, 2))
}
```

---

## CLAUDE.md Updates Required

Add to dependencies:
```json
"@slack/web-api": "^7.x"
```

Add to environment variables:
```
SLACK_USER_TOKEN=xoxp-...
SLACK_CONFIG_PATH=./config/slack.json
```

Add to .gitignore (optional, user decides):
```
config/slack.json
```

---

## Notes for Implementation

- Resolve the authenticated user's own ID once at startup using `auth.test()` — needed for mention detection and filtering out the user's own messages from summaries
- When rendering message text, convert Slack's mrkdwn user mentions (`<@U012AB3>`) to display names using the cached user map
- Timestamps in Slack are Unix timestamps as strings — convert to readable local time for display
- `conversations.list` may need multiple paginated calls for workspaces with many channels — always follow `response_metadata.next_cursor`
- Bot messages (`subtype: 'bot_message'`) should generally be filtered out unless they contain keywords like "incident", "alert", "failed", "error" — in which case include them
