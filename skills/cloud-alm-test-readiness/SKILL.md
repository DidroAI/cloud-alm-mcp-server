---
name: cloud-alm-test-readiness
description: Check readiness for a test phase or go-live in SAP Cloud ALM — integration test or UAT entry criteria, test coverage of requirements, prepared test cases, test plan progress, open defects by priority — and give a go / no-go recommendation with the blocking items. Use before UAT or SIT starts, at a test exit review, or for a cutover / go-live readiness check.
---

# Test and go-live readiness in SAP Cloud ALM

Needs the `cloud-alm` MCP server; a read-only key is enough. Ask which gate
(SIT entry, UAT entry, UAT exit, go-live) and which scope (all, or a
process area) if the user did not say.

## 1. Measure

1. `calm_overview`: phase, test plans, results, open defects.
2. Coverage: `calm_gaps` with `checks: ["coverage"]` (every requirement ×
   test cases × latest result). Page with `offset` until done.
3. Untested and unprepared: `calm_gaps` with
   `checks: ["untested", "unprepared_tests", "orphan_tests"]`.
4. Failures: `calm_gaps` with `checks: ["failed_tests"]`; `calm_get` the
   failed test cases to see their defects.
5. Defects: `calm_list` `types: ["defect"]`, `status: "open"`; group by
   priority; `calm_trace` the very-high ones to the requirement they block.
6. Build state: features of the scope in testing or deployed vs still in
   realization (`calm_overview`, `calm_trace` on processes).
7. Plan progress: `calm_list` `types: ["test_plan"]`, then `calm_get` the
   plan(s) for executed vs planned.

Coverage rolls each requirement up with its user stories (`rollup`): use
the rollup for requirements tested through their stories. The test plan
read gives executed and pass rates (`fields.progress`). Step-level results
are not in the API.

## 2. Apply the criteria

Use the project's criteria if a document states them (`calm_list`
`types: ["document"]`, words "test strategy", "exit criteria"). Otherwise
propose these and say they are defaults:

| Gate | Default criteria |
| --- | --- |
| SIT / UAT entry | 100% of in-scope requirements have a prepared test case; features in testing; no very-high defect open from the previous phase |
| UAT exit | ≥ 95% executed, ≥ 90% passed; no very-high and no high defect open without an agreed workaround |
| Go-live | UAT exit met; all features deployed; open defects accepted by the business with a date |

## 3. Report

1. **Recommendation**: go / go with conditions / no-go, in one line.
2. **Criteria table**: criterion, target, actual (with numbers), met?
3. **Blockers**: each with id, why it blocks, owner, what would clear it.
4. **Conditions** for a conditional go, with dates.
5. **Coverage gaps** by process.

Optional, on the user's yes: tag blockers (`calm_tag`
`add: ["go-live-blocker"]`) or add a comment on each (`calm_comment`).
Each write waits for the user's approval.
