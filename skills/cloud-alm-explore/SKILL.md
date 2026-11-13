---
name: cloud-alm-explore
description: How to find your way around an SAP Cloud ALM tenant with the cloud-alm MCP tools — where requirements, user stories, features, test cases, processes and documents live, how they link, and which tool answers which question. Use when asked anything about a Cloud ALM project.
---

# Exploring SAP Cloud ALM

Draft. Uses the `cloud-alm` MCP server's `calm_*` tools (read-only).

## How a project is laid out

- A **project** has timeboxes (phases, sprints) and teams. Almost everything
  else hangs off a project id: start with `calm_list_projects`.
- A project's **scope** selects **solution processes** (e.g. "Lead to
  Cash"): `calm_list_scopes`, `calm_list_processes`.
- **Tasks** are one list with a type: requirement, user story, defect,
  roadmap task, project task, risk… `calm_search_tasks` filters by type,
  status and words in the title. User stories sit under a requirement.
- **Features** deliver requirements and user stories, and carry the
  transport ids that move the change into the SAP system:
  `calm_list_features`, `calm_get_feature`.
- **Test cases** (manual with activities and steps, or automated) cover
  requirements and processes; **test plans** group them for a test run.
- **Documents** (solution designs, specs) attach to processes, tasks and
  test cases.
- The **landscape** lists the systems and cloud services; the
  **cross-library** documents applications, developments (custom code),
  interfaces and configurations.
- **Analytics** returns aggregated counts (rows per combination of
  dimensions, not records): use it for "how many open defects per
  priority", not to list items.

## Working rules

- Lists show ids in `[brackets]`: pass them to the `get` tools.
- Lists page with `limit` and `offset`; the answer says the next offset.
- Start broad (projects → scope → processes → tasks by type), then drill
  into single items. Do not fetch every item one by one when a list or
  analytics answers the question.
- A tool that answers `forbidden` means the key lacks that area's scope;
  say so and carry on with the other tools.
