---
name: cloud-alm-status-report
description: Write a project status report from SAP Cloud ALM for a steering committee, a weekly status meeting or a client update — phase and timeline, scope progress, build, testing, defects, risks, decisions needed, and what changed since the last report. Use when asked for a status report, a steerco deck outline, a weekly update or "where do we stand" for management.
---

# Status report from SAP Cloud ALM

Needs the `cloud-alm` MCP server; a read-only key is enough. Ask for the
audience (steering committee, project team, client) and the date of the
last report if the user did not say.

## 1. Collect (in parallel where the client allows)

| Section | Call |
| --- | --- |
| Phase, timeboxes, counts | `calm_overview` |
| What changed since the last report | `calm_changes` with `since` = last report date |
| Scope progress | `calm_list` `types: ["requirement"]`, by `status` (open, approved, in realization, done); features from `calm_overview` |
| Build | features by status (in realization, in testing, deployed) |
| Testing | test plans and results from `calm_overview`; failed tests with `calm_gaps` `checks: ["failed_tests"]` |
| Defects | `calm_list` `types: ["defect"]`, `status: "open"`, by priority |
| Overdue and unassigned | `calm_list` `dueBefore` = today, `status: "open"`; `assignee: "none"` |
| Risks | `calm_list` `query: "risk"` or tasks tagged as risks; blocked items (`status: "blocked"`) |
| Trends | `calm_analytics` (e.g. `dataset: "Defects"`, `groupBy: ["status"]`, or `["date"]` for a series); analytics are refreshed daily |

## 2. Judge

Give each area a status, with the reason in one line:

- **Green**: on plan, no open very-high defect, no overdue milestone.
- **Amber**: slipping but recoverable: overdue items, failed tests with
  defects in progress, unassigned work.
- **Red**: a milestone at risk: very-high defects open near a test or
  go-live date, blocked requirements, untested scope close to UAT.

Base every judgement on numbers from the tools and say where they come
from. Do not invent dates; if phases have no dates in Cloud ALM, say so.

## 3. Write

For a steering committee, one page:

1. **Overall status** (green/amber/red) and the headline in two sentences.
2. **Since last report**: done, started, new (from `calm_changes`).
3. **Scope and build**: requirements by status, features by status.
4. **Testing**: plans, executed vs planned, pass rate, failed tests.
5. **Defects**: open by priority, oldest very-high ones by id.
6. **Risks and issues**: top 3, each with owner and mitigation.
7. **Decisions needed** from the committee.
8. **Next two weeks**: what is due (`dueBefore`).

For a team meeting, add the item ids and owners per line. Cite ids
everywhere so readers can open them in Cloud ALM.

Optional, on the user's yes: store it with `calm_create_document`
(type "Status Report" or the project's own), linked to the project.
