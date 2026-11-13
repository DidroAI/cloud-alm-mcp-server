---
name: cloud-alm-test-design
description: Find what is untested in an SAP Cloud ALM project and write manual test cases (activities, steps, expected results) linked to the requirements and user stories they cover; tag tasks; log defects from failed runs. Use when asked to check test coverage, draft or create test cases, or follow up failed tests in Cloud ALM.
---

# Test design in SAP Cloud ALM

Needs the `cloud-alm` MCP server. Creating and linking needs write mode
(`CALM_WRITE=on`, or `dry-run` to preview); without it, draft the test
case in the answer instead.

## 1. Find the gap

`calm_gaps` with `checks: ["untested", "failed_tests", "features"]` lists
requirements and user stories without a test case, test cases whose latest
run failed, and features whose tasks are untested. Prefer items of features
in testing or realization, and high priority (10, 20).

## 2. Read what is to be tested

`calm_get` the requirement or user story (all ids at once) and
`calm_trace` it to see its requirement, feature, documents and existing
test cases. Reuse existing test cases' style (`calm_get` one of them).
Never invent business data the item does not imply; use placeholders like
"a customer with a credit limit" when values are unknown.

## 3. Write the test case

- **Title:** what is verified, as the business says it ("Release a
  credit-blocked order from the worklist").
- **Activities:** the business steps in order (2–5), each a group of
  steps.
- **Steps:** one action each. `description` = what to do and with which
  data (Cloud ALM refuses an empty one); `expected` = an observable result
  a tester can check ("Credit status is released", not "works").
  `evidence: true` on steps whose result must be proven (screenshot).
- Cover the acceptance criteria of the item; add one negative step when
  the item has a rule (limit exceeded, missing data).

## 4. Create, carefully

1. Call `calm_create_test_case` with `dryRun: true` and `covers` set to the
   item ids; show the user the plan.
2. Create only after the user agrees. A test case **cannot be deleted,
   tagged or given a process through the API**: a wrong one stays until
   someone deletes it in the Cloud ALM UI.
3. The answer gives the new id and the steps stored; report both.

To link an existing test case instead, use `calm_link` (`from` = test
case, `tasks` = items). Tags go on tasks (`calm_tag`), not on test cases.

## 5. Failed runs

For a failed test case, `calm_get` it (steps and latest result) and the
items it covers, then `calm_create_task` with `type: "defect"`: title =
what is wrong, description = test case id, failing step, expected vs.
observed, plan. Do not log a defect twice: `calm_find` with
`types: ["defect"]` and words of the failure first.
