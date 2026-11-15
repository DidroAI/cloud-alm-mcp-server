# Realistic Cloud ALM prompts

Fifty prompts written the way people on an SAP implementation project would
ask an assistant connected to this server. Grouped by who asks. Prompts marked
**(write)** ask for a change; in an evaluation run the agent stops at the
proposal and never approves it.

## A. Project manager / PMO

1. Where does our Cloud ALM project stand? Give me a five-line status I can paste into the steering committee mail.
2. Which requirements are still open, and how many of them have no user story yet?
3. What changed in the project this week? New defects, items closed, test runs.
4. List everything assigned to nobody that is due in the next two weeks.
5. Which project tasks are overdue, and who owns them?
6. How many defects did we open per week over the last month? Is the trend going up?
7. Compare the open defects by priority with last week, if you can.
8. We are in the Explore phase. What should be done before we can move to Realize, judging by what is in Cloud ALM?
9. **(write)** Create a project task "Prepare cutover rehearsal plan" due 15 December, high priority.
10. **(write)** Mark requirement REQ-03 as not relevant, with a comment that the customer dropped it in the last workshop.

## B. Test manager

11. Which tests failed in the current test cycle, and is there a defect for each failure?
12. Show me the test plan for UAT cycle 1: how many cases passed, failed, are in progress, not run.
13. Which requirements or user stories have no test case at all?
14. Give me the steps of test case O2C-02 with the latest result of each step.
15. Which test cases have never been run?
16. Which failed test cases block a requirement we committed for go-live?
17. **(write)** Create a manual test case for user story "Credit limit warning": three steps, create an order over the credit limit, check the warning, release with approval.
18. **(write)** Link test case 8-1-9 to requirement 3-17.
19. **(write)** Create a defect from the failed step 2 of test case 8-1-2, with the step's expected and actual result in the description.
20. Is test coverage better or worse than a week ago?

## C. Functional consultant / solution architect

21. What is requirement REQ-04 about, and what is it linked to?
22. Trace the export declaration user story end to end: requirement, features, transports, tests, documents.
23. Which solution processes are in scope, and which requirements hang under each?
24. Find everything about credit management: requirements, stories, defects, documents.
25. Read the functional specification document for the order to cash scope and summarise it.
26. Which requirements mention pricing, including in their description?
27. **(write)** Create a user story "As a credit controller I see blocked orders in one list" under the credit check requirement.
28. **(write)** Tag all credit-related requirements with "Credit management".
29. **(write)** Add a comment on defect 3-12: "Reproduced in QAS, client 100."
30. Are there duplicate or near-duplicate requirements?

## D. Developer / release manager

31. Which features are ready to transport, and which transports belong to each?
32. Which transports belong to feature FEAT-02, and what is their status?
33. Which features have no requirement or user story linked?
34. Which features are in development but have failing tests?
35. **(write)** Set feature 6-2 to "In Testing".
36. **(write)** Create a feature "Credit block list app" delivering the credit controller user story.
37. What will go live in the next release, judging by feature status?

## E. Operations / IT basis

38. Are there any SAP service outages or maintenance windows affecting us right now?
39. How many failed background jobs did we have in the last seven days, by system?
40. Any integration message errors this week?
41. Which systems and cloud services are in our landscape?
42. Is there planned SAP maintenance in the next two weeks?

## F. Newcomer / executive / auditor

43. I just joined the project. Explain what is in Cloud ALM and where I should start reading.
44. Give me a one-paragraph executive summary with three risks.
45. For audit: show that every requirement in scope has an approved test with a passing result, or list the exceptions.
46. Who has been most active in the project in the last two weeks?
47. Export the list of open defects as a table with id, title, priority, status, owner and age in days.

## G. Edge cases

48. Open item 3-999.
49. **(write)** Delete all defects.
50. Show me the project "Phoenix rollout".
