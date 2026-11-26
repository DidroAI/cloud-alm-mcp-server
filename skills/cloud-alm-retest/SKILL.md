---
name: cloud-alm-retest
description: Build a read-only SAP Cloud ALM retest list for a specific change and test cycle. Use when a test lead asks which cases to rerun after a fix, requirement update or feature change, and why.
---

# Which tests need another run?

Use a read-only connection. State the project, the changed records and the target test plan. For a named change, find the record with `calm_list` or read its ID directly. For “what changed since Friday?”, use `calm_changes` with the requested date and follow its page offsets. A modification date gives a reason to investigate. A dated description of the fix or confirmation from its owner can establish what behavior changed.

## Follow the evidence

1. Resolve the target cycle using `calm_list` with `types: ["test_plan"]`. If several plans fit, ask which one to use. Keep results from separate cycles identifiable throughout.
2. Use `calm_trace` on each changed record. For a defect, follow its originating case and the requirements or stories that case covers. A coverage link establishes possible impact. Verify that a defect actually prevents execution before calling it a blocker. For a feature, follow the tasks it delivers. For a requirement, inspect its own cases and the cases linked through its stories. Use the recorded IDs to retain each path from the change to a case. Similar titles alone are leads for a person to check.
3. Get the plan-specific coverage with `calm_gaps`, `checks: ["coverage"]`, `includeClosed: true` and `testPlanId` set to the plan display ID or GUID. Follow the page offsets and match the traced task and case IDs. Read the plan with `calm_get` for a directly affected case without a task link. For the last run date, read the case and use a result only when it can be matched to this cycle unambiguously. Include gaps from unreadable, truncated or unmatched records.
4. Compare the result with evidence that the fix reached the test system. A transport ID or a feature marked deployed does not date the import into that system. If only a record timestamp is available, ask when the tested build changed. If the order of events is uncertain, say so.

## Return a runnable list

Give one row per test case per plan, with its ID, title, affected process or requirement, latest cycle result and date if available, and the decision with its reason. Preserve multiple traced paths on the same row. Use the owner only when recorded for the action in question.

- **Rerun** a failed case once its fix is available, or a previously passed case whose tested behavior changed after that pass. Put cases on hold when a linked blocker still prevents a useful run. Group cases under a shared blocker only when the evidence identifies the same cause.
- **Run for the first time** when an affected case is assigned and still unexecuted. Flag a relevant unassigned case for the test lead to add to the cycle. Report an unreadable assignment or result as unknown.
- **Already covered** when a pass in the selected cycle demonstrably exercised the changed behavior on the fixed build. Cite the evidence that makes skipping another run defensible.
- **Needs investigation** when the change's content, its test-system arrival, or the links to a relevant case are missing. Show the unresolved item ID and the specific question that would settle it.

A retest list is a recommendation. Leave execution, defect status and test-plan membership unchanged.
