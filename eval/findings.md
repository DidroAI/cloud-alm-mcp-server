# Findings: 50 prompts and a best-practice review (2026-11-15)

> A record of that day's runs, kept as written. Names and open items have
> changed since: `calm_find` is now `calm_list`, and the links to the Cloud
> ALM UI and the icons listed under "Still open" have shipped. For the
> current tools see [docs/tools.md](../docs/tools.md).

Five agents ran the 50 prompts in [prompts.md](prompts.md) against the live
tenant through the server (about 100 tool calls; no rate limits; nothing
written, every write stopped at its proposal). A sixth reviewed current MCP
practice and how GitHub, Sentry, Supabase, Cloudflare, Atlassian and Notion
shape their output. Items marked ✔ were checked in the code.

## What works

- One call answers the common questions: status (P1), failed tests and their
  defects (P11), gaps (P8, P13), service status (P38), test plan status (P12).
- Display ids and title codes resolve in every read; the next tool is named in
  each answer; write proposals are clear, with a `next` step the agent follows.
- Workflow-shaped tools, readable ids, server instructions, annotations,
  paging in `calm_find` and the approval handle all match current practice.

## Bugs (fix before 0.1.0)

1. ✔ **Title codes fail in write tools.** `calm_update ["REQ-03"]`,
   `calm_comment`, `calm_create_task requirement:"REQ-03"` answer `not_found`;
   writes resolve display ids and GUIDs only, reads also resolve codes. The
   error gives no hint. (P10, P27)
2. **Changes that change nothing still ask for approval.** `calm_update` to the
   current status, `calm_tag` with a tag already set: preview says "no
   change", answer still carries an approval id. (P28, P35)
3. **`calm_analytics` contradicts itself.** `release` is listed under "Group
   by" and refused; the description says groups count the latest day, while
   `groupBy:["date"]` returns a daily series; rows without groupBy are cut to
   10 without saying "10 of 27"; a filter that matches nothing does not say
   why. (P3, P20, P37)
4. ✔ **Owner and due date are invisible when empty.** Task lines print
   assignee and due date only when set, so "unassigned" and "not shown" look
   the same; `calm_create_task` has no due date, start date or assignee, so a
   due date in the request is silently dropped. (P4, P5, P9, P47)
5. **Empty is ambiguous.** `Jobs: no rows`, `transports: none` read as "no
   failures" / "no transports" when monitoring or the integration may not be
   set up. (P32, P39, P40)
6. **Status words differ between output and filter.** Output says "not run
   yet" / "no result", the filter takes `initial`, and there is no filter for
   never run. (P12, P15)

## Output shape

The question "why plain text": it is not wrong, but the vendors moved on.
GitHub and Sentry declare `outputSchema` and return `structuredContent`
(JSON) on list and search tools, with markdown kept for long details; nobody
else returns text only. Some hosts (Claude Code, ChatGPT) may show the model
only `structuredContent`, so it has to stand on its own.

7. **Structured output on data tools.** `calm_find`, `calm_gaps`,
   `calm_overview`, `calm_analytics` declare an `outputSchema` and return
   `structuredContent` (ids, type, status, priority, assignee, dates, links,
   paging); today's text stays in `content`. `calm_get` and `calm_trace` stay
   text. Approval `expiresAt` becomes an ISO time.
8. **No size budget on `calm_get`.** Ten items with full descriptions and
   documents print without a cap (Claude Code cuts at 25k tokens). Add a budget
   with "truncated, call calm_get 7-1 alone", and `detail: summary|full`;
   roadmap tasks return about 6k characters of template text. (P4)
9. **Text from Cloud ALM is not marked as data.** Descriptions, comments and
   documents reach the model unmarked while write tools are on: a prompt
   injection path. Wrap them in a delimited block and say so in the
   instructions.
10. **Errors without a next step.** `not_found` should name the nearest items
    or the valid form; "read failed unexpectedly" should say what to try.
    (P10, P17, P48, P50)

## Missing capabilities, by how often they blocked an answer

11. **Step results of a test case.** Only "3 of 4 steps passed"; which step
    failed and its actual result are not shown. Blocks "defect from step 2".
    (P14, P19)
12. **Defect from a test.** `calm_create_task` cannot link a defect to its test
    case, and does not warn that an open defect already covers it. (P19)
13. **Search in descriptions and documents.** `calm_find` matches titles and
    tags only; "credit" also finds "letter of credit". (P24, P26, P30)
14. **What changed since.** No change feed; analytics are daily, tenant-wide
    counts. (P3, P6, P20)
15. **Projects.** No list or lookup by name; `projectId` takes a GUID only;
    "Phoenix rollout" reads as "0 matches". (P50)
16. **Coverage for audit.** A requirement × test × latest result view (and
    approval state) instead of a four-call join. (P16, P45)
17. **Bulk delete.** "Delete all defects" is a normal proposal; it should say
    "all 3 defects in the project; 3 failed tests lose their defect" and
    prefer `soft`. (P49)
18. **One intent, one approval.** Status change plus comment, create plus due
    date: two proposals today. (P9, P10)
19. **Previews omit what will be written.** Test steps and descriptions are not
    echoed, the scope is chosen silently. (P17, P19)
20. Smaller: `calm_gaps` paging and `includeClosed`; project phase vs item
    phase labelled; get/trace descriptions say when to use which; a `depth`
    for trace; process names accepted as ids; document ids in the overview.

## Platform (after 0.1.0)

- The current spec is 2026-07-28 (stateless, `server/discover`, multi
  round-trip requests replace server-initiated elicitation, tasks move to an
  extension). Our SDK negotiates 2025-11-25. Plan the move to the v2 SDK; the
  approval handle already fits the stateless model.
- `icons`; links to the Cloud ALM web UI (`resource_link`) so users can open
  records.

## Tenant hygiene (not the server)

Leftover `[mcp-test]` and probe items (3-29, 6-5, 6-6, TC-90 …) and null
"ghost" defects in analytics showed up in several answers. Set them to not
relevant or obsolete.

## Second run (same day, after the rework)

The 50 prompts ran again on the new build, over MCP 2026-07-28, through
five agents (about 80 tool calls; nothing written). Then the items below
were fixed and checked live.

Fixed and confirmed in the second run: title codes in writes (1), no
approval for no-ops (2), structured output on every read (7), the
`calm_get` budget and `detail` (8), fenced Cloud ALM text (9), description
search (13), `calm_changes` (14), projects by name (15), `coverage` (16),
bulk delete warnings (17), change plus comment in one approval (18),
previews that echo what is written (19), gaps paging (20).

Fixed after the second run: analytics filters applied by the server and
echoed, empty rows of deleted items dropped, group and row counts apart;
typed `covers` / `defects` / `priority` in gaps data; trace starts from the
resolved id and lists defects per test case; `createdAt` in list rows;
list text always shows the owner and a test case's state; empty lists say
why; coverage counts unprepared tests as not ready; near-duplicate,
overlapping-feature and already-tested warnings on creates; property
hints from `calm_api`; id-range hints on unknown ids; processes by name;
`calm_changes` by type, with test results counted as `calm_overview` does.

Not possible through Cloud ALM's API: which step of a run failed and its
actual result; linking a defect to a test case ("must be a User Story or
Requirement"); who changed an item, and a change log.

Still open: releases and milestone dates (no feature has a release on the
tenant), a phase filter, a duplicates check across existing items, Cloud ALM
web links (`resource_link`), icons, and tenant hygiene (the `[mcp-test]`
items).
