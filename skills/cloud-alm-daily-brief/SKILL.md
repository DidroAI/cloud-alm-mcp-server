---
name: cloud-alm-daily-brief
description: A short morning brief on an SAP Cloud ALM project — what moved since the last working day, what is newly at risk (failed tests, very-high defects, overdue items, coverage gaps), what is due this week, and SAP service events — in under 300 words with item ids and links. Use for "what changed", "morning update", "brief me", a stand-up, or a scheduled daily summary sent to Teams or e-mail.
---

# Daily brief from SAP Cloud ALM

Needs the `cloud-alm` MCP server; a read-only key is enough. Default period:
since the last working day (Monday: since Friday). Ask nothing unless the
tenant has several projects and none is named.

## 1. Collect (one round, in parallel where the client allows)

| What | Call |
| --- | --- |
| What moved | `calm_changes` with `since` = last working day |
| Failing now | `calm_gaps` with `checks: ["failed_tests"]` |
| Very-high defects, and unassigned ones | `calm_list` `types: ["defect"]`, `status: "open"`, `sort: "priority"` |
| Overdue and due this week | `calm_list` `status: "open"`, `dueBefore` = Friday of this week, `sort: "due"` |
| New coverage gaps | `calm_list` `types: ["requirement", "user_story"]`, `hasTests: false`, `changedSince` = the same day |
| Test progress | the `testResults` of `calm_changes` (first and last day) |
| SAP outages and maintenance | `calm_landscape` (only open or upcoming events) |

"Mine": the key carries no user. If the user names themselves, filter with
`assignee` (part of their name); otherwise leave the "mine" section out.

## 2. Write (under 300 words)

1. **Headline**: one line, e.g. "4 tests failed since Friday; 1 very-high
   defect still unassigned."
2. **Moved**: created and changed counts by type, then the 3–5 changes that
   matter (status to done, new defects, requirements approved).
3. **At risk**: failed tests with their defects, very-high defects without
   an owner, overdue items. Each with its id and, when the data has one, its
   `url` as a link.
4. **Due this week**: by due date.
5. **SAP services**: open or announced events, or "none announced".

Say what the data cannot tell: Cloud ALM keeps no change log, so who changed
an item is unknown; analytics are refreshed daily. Never invent a reason
for a change.

## 3. Send or schedule (only when asked)

If another connector is available (Teams, Outlook, Slack), offer to post
the brief there; show the text first and send only on the user's yes. For a
daily brief, the host's scheduler (for example a scheduled task in Claude)
can run this skill each working morning.
