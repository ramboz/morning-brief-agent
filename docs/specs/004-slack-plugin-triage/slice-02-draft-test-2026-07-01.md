# Native Slack draft test — 2026-07-01 (slice 004-02 close-out)

Live test of `slack_send_message_draft` against a low-risk destination: the
user's own self-DM channel (`W4RUEF88M`, resolved channel `D19QPHQP2`, `name:
ramboz`, `is_dm: true`). Nothing was sent — drafts only.

## Call 1 — create

```json
{"channel_id": "W4RUEF88M", "message": "**[slice 004-02 test draft]** ..."}
```

Result:
```json
{"channel_link":"https://adobe.enterprise.slack.com/archives/D19QPHQP2","widget_id":"31a5973f-ed01-4182-96e4-9d94f132033c","draft_id":"Dr0BEKB2LLD8","channel_info":{"channel_id":"D19QPHQP2","name":"ramboz","is_dm":true},"result":"Draft message is created. They can edit it before sending."}
```

`draft_id` present — a new draft, `Dr0BEKB2LLD8`.

## Call 2 — repeat, same channel, different text

Expected per the tool's own documentation: `draft_already_exists` ("Only one
attached draft is allowed per channel").

Actual result:
```json
{"channel_link":"https://adobe.enterprise.slack.com/archives/D19QPHQP2","widget_id":"bed8ce39-947e-41e7-a14e-ba41b5c60edf","channel_info":{"channel_id":"D19QPHQP2","name":"ramboz","is_dm":true},"result":"Draft message is created. They can edit it before sending."}
```

**No error.** Succeeded again — but `draft_id` is absent this time (present
on call 1, absent on calls 2 and 3). No error, no explicit "updated"
signal either.

## Call 3 — repeat again, to confirm the pattern

```json
{"channel_link":"https://adobe.enterprise.slack.com/archives/D19QPHQP2","widget_id":"9f1f92f2-2d63-4e18-b102-1713246c2e3a","channel_info":{"channel_id":"D19QPHQP2","name":"ramboz","is_dm":true},"result":"Draft message is created. They can edit it before sending."}
```

Same shape as call 2: success, no error, no `draft_id`.

## Call 4 — `thread_ts` branch (AC2, threaded-reply context preservation)

Craft review correctly flagged that calls 1-3 only exercised the bare,
unthreaded path — AC2's `thread_ts` branch was asserted in
`skills/morning-slack/SKILL.md` §3b but never actually tested. Fixed by
finding a real prior message in the same self-DM (`Message TS:
1749753638.544919`, "File epic for Rafael's work", 2025-06-12) and drafting
a threaded reply to it:

```json
{"channel_id": "D19QPHQP2", "thread_ts": "1749753638.544919", "message": "**[slice 004-02 test]** Testing the thread_ts branch..."}
```

Result:
```json
{"channel_link":"https://adobe.enterprise.slack.com/archives/D19QPHQP2","widget_id":"89d3fe10-bc94-4369-8a10-49c17eb69204","draft_id":"Dr0BEHBX9C06","channel_info":{"channel_id":"D19QPHQP2","name":"ramboz","is_dm":true},"result":"Draft message is created. They can edit it before sending."}
```

`draft_id` present again (`Dr0BEHBX9C06`) — despite this being the 4th call
to the same channel. **New finding:** a threaded draft reply gets its own
`draft_id` and did not collide with the unthreaded attached draft from
calls 1-3. This suggests "only one attached draft per channel" applies to
the channel-level (non-threaded) draft specifically; a threaded reply draft
appears to be tracked per-thread instead. This is consistent with — not
contradicting — the AC3 conflict-handling code path: a real conflict would
still occur if two drafts targeted the *same* thread (or the same
unthreaded channel slot) with someone else able to observe it; this
self-DM test still can't provoke that specific case (see below), but it
now covers both the unthreaded (calls 1-3) and threaded (call 4) creation
branches, closing the craft review's gap.

## Finding

**`draft_already_exists` did not reproduce for a self-DM channel** across
four calls (three unthreaded, one threaded) with different message text/
targets. The most likely explanation for the unthreaded case, based on the
`draft_id`-present-then-absent pattern in calls 1-3, is that repeat calls to
a self-DM's unthreaded attached-draft slot **update it in place** rather
than erroring — self-DMs may be handled differently from a DM/channel
shared with someone else (the tool's docs describe the *shared-channel*
conflict case: another party's UI would show a lingering "in progress"
indicator if a stale draft sat there, which doesn't apply to your own
self-DM the same way).

**This does not invalidate AC3** — the workflow (see
`skills/morning-slack/SKILL.md` §3c) still checks for and handles
`draft_already_exists` whenever the tool actually returns it, which per the
tool's own documentation happens for a real channel/DM shared with someone
else. What this test establishes is narrower: **the conflict could not be
provoked in the one destination low-risk enough to safely test against**
(a self-DM), for either the unthreaded or threaded creation path. Provoking
a real conflict would require creating a second attached draft in a
colleague's DM or a real channel — out of scope for a "low-risk" DoD test,
and not attempted.

## Cleanup

The self-DM (`https://adobe.enterprise.slack.com/archives/D19QPHQP2`) has
two attached drafts left over from this test: one unthreaded (updated
in-place by calls 1-3) and one threaded reply under the 2025-06-12 "File
epic for Rafael's work" message (call 4). No delete-draft tool was
available to the session; the user can delete or ignore them directly in
Slack — neither was ever sent and both are visible only to them.
