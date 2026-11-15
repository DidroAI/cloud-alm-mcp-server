---
name: cloud-alm-explore
description: Answer questions about an SAP Cloud ALM project with the cloud-alm MCP tools — status, requirements, user stories, defects, features and transports, test cases and results, documents, processes, gaps. Use whenever a question is about Cloud ALM content.
---

# Exploring SAP Cloud ALM

The `cloud-alm` MCP server answers most questions in one or two calls.
Pick the tool by the question, not by the object:

| Question | Call |
| --- | --- |
| "What is in the project / where do we stand?" | `calm_overview` |
| "Which … are there?", "anything about X?" | `calm_list` (words, `types`, `status`, `tag`) |
| "What does 3-17 say?", "steps of 8-1-2" | `calm_get` with all the ids at once |
| "What is linked to / delivers / tests X?" | `calm_trace` |
| "What is missing, untested, failing?" | `calm_gaps` (narrow with `checks`) |
| "How many … per …?" across the tenant | `calm_analytics` with `groupBy` |
| "Is a service down?", "which systems?" | `calm_landscape` |

## How Cloud ALM is laid out

- A **project** moves through phases (Discover, Prepare, Explore, Realize,
  Deploy, Run); its **scope** selects **solution processes** (e.g. Lead
  to Cash).
- **Tasks** are one list with a type: requirement, user story, defect,
  project task, roadmap task (from the project template), risk. A user
  story or project task sits under a requirement.
- A **feature** delivers requirements and user stories and carries the
  **transports** that move the change into the SAP system.
- **Test cases** (manual with activities and steps, or automated) cover
  requirements and user stories; **test plans** run them, and each run has
  a result (passed, failed, in progress).
- **Documents** (solution designs, specs) attach to tasks, test cases and
  processes.

## Working rules

- Ids: use the display ids the tools print (`3-17`, `6-1`, `8-1-2`). Put
  them in your answer so the user can find the item in Cloud ALM.
- Read several items in one `calm_get`; do not loop one by one.
- `calm_list` matches titles and tags, not descriptions: try synonyms with
  `|` (`export | letter of credit`).
- Analytics are refreshed daily and are tenant-wide; items created today
  may be missing there. Counts from `calm_overview` are live.
- Coverage and gaps count **direct links** only; say so when a requirement
  is covered only through its user stories.
- "Not readable with this key" means the key lacks a scope: say which part
  is missing and answer from the rest.
- With several projects, pass `projectId` (from `calm_overview`).
