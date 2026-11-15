---
name: cloud-alm-backlog-from-notes
description: Turn workshop minutes, meeting notes, a transcript or an e-mail into SAP Cloud ALM backlog items — requirements, user stories, project tasks, defects and comments — without duplicates, linked to the right parents, each write approved by the user. Use when a consultant pastes notes and asks to "log", "capture", "create the requirements" or "update Cloud ALM".
---

# From notes to the Cloud ALM backlog

Needs the `cloud-alm` MCP server and a key with `tasks.write`; each write
waits for the user's approval. With a read-only key, produce the list and
let the user enter it.

## 1. Extract

From the notes, list candidate items. For each: type, title (what the
business needs, not how: "Block deliveries for customers over their
credit limit"), description (context, rule, acceptance criteria as
"Given / When / Then" or a checklist), priority if stated, owner and due
date if stated, the process it belongs to.

| In the notes | Becomes |
| --- | --- |
| A business need or rule | requirement |
| A change to build for a requirement | user story under that requirement |
| An action with an owner and a date | project task (assignee, dueDate) |
| Something broken in a test or a system | defect |
| A decision or an update on an existing item | comment on that item |
| A status change ("approved", "done") | update of that item |

Keep the notes' words for business terms; do not invent values, owners or
dates. Leave a field out rather than guess it.

## 2. Match against Cloud ALM

For each candidate:

1. `calm_list` with words of the title (and synonyms with `|`), types as
   above; `searchText: true` when titles in the project are short.
2. If an item already covers it, the action is a comment or an update on
   that item, not a new item.
3. Parents: a user story needs its requirement (`requirement` = id); find
   it the same way.
4. Owners: `calm_team` gives user ids; match names from the notes there
   only.

## 3. Show the plan

One table: action (create / comment / update), type, title, parent,
owner, due date, and the existing item it touches. Ask the user to
confirm or edit it. Do not write before that.

## 4. Write

For each confirmed row, one call; each returns a proposal the user
approves (card or "yes" in the chat, then `calm_confirm` with its id):

- create: `calm_create_task` (`type`, `title`, `description`,
  `requirement`, `priority` 10/20/30/40, `assignee`, `dueDate`, `tags`);
  read its similar-title warning before proposing.
- comment: `calm_comment` (`task`, `text`).
- update: `calm_update` (`ids`, `status`, `assignee`, `dueDate`, and
  `comment` to explain the change in the same approval).

Report the ids created and changed. Mention items left out and why.
