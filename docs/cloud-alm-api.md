# Cloud ALM API notes

What the server works around in SAP Cloud ALM's APIs, its errors, and its safety limits. Back to the [README](../README.md).


- **Path casing differs per service**: REST services use lower case
  (`projects`, `tasks`, `landscapeObjects`, `solutionProcesses`), OData
  services capitalised entity sets (`Features`, `ManualTestCases`). The
  wrong case answers 404. The library holds the right paths.
- **Tasks need a project.** Cloud ALM answers 400 without `projectId`.
  Without one, `listTasks` reads every project (up to 10) and merges.
- **GUID filters go unquoted** in OData (`projectId eq 1234…`); a quoted
  GUID answers 400 (`Edm.Guid` vs `Edm.String`). Ids are checked as GUIDs
  before they go into a path or a filter.
- **Paging differs**: OData services take `$top`/`$skip`/`$count`; tasks,
  landscape and status events take `limit`/`offset`; process management
  takes a literal `$top`/`$skip`. Every list here takes `{ limit, offset }`
  (limit 1–200, default 50) and returns
  `{ items, offset, limit, nextOffset, total }`. `nextOffset` is null on
  the last page (one extra row is fetched to know). `total` is set when
  Cloud ALM counts (OData).
- **Errors come in four shapes** (`{message}`, `{error:{message}}`,
  `[{message}]`, `{message,status}`); the library reads all of them.
- **Analytics rows are aggregates**, one per combination of dimension
  values, not records. Unknown or unfilterable dimensions in `filters` are
  ignored by Cloud ALM. Some datasets refuse without a filter (428, e.g.
  `ServiceLevels` needs a business service id).
- **Links live with one side.** A task's test cases are found from Test
  Management (`toTaskAssignments/any(a:a/taskId eq …)`), its features
  from the task's feature assignments, its requirement from relation type
  10 (`parentId` stays empty), its processes from
  `tasks/solutionProcessAssignments`. A link the key has no scope for is
  listed as not readable instead of failing the task. `calm_gaps`
  counts direct links only: a requirement tested only through its user
  stories counts as uncovered.

## Errors

Every failure is a `CloudAlmError` with a `code` and a short `reason`:

| Code | When |
| --- | --- |
| `unauthorized` | no usable token, expired token, 401, key refused by the token endpoint |
| `forbidden` | 403: the key lacks the scope for this call |
| `not_found` | 404 (also a wrong path) |
| `rate_limited` | 429 after two short retries (Cloud ALM allows about 500 requests per 5 s per tenant) |
| `unavailable` | 5xx, network error, timeout (30 s per operation), non-JSON or oversized answer |
| `bad_request` | 400, 422, 428, or an argument this library refused (bad id, limit, type) |

A reason never carries the token, the secret or a raw response body; long
opaque strings are redacted.

## Safety

The reader (`CloudAlm`) sends GET only, to the grant's `baseUrl` only,
which must be `https://` on a `*.alm.cloud.sap` host (`hostPattern` option
to change it for a test double). No redirects followed. At most 40 requests
and 30 seconds per operation; answers above 8 MB are refused.

The writer (`CloudAlmWriter`), used only in write mode, sends POST, PATCH
or DELETE only to a fixed allow-list of (method, path) pairs: create and
change tasks, features, documents and manual test cases (with their
activities and steps), comments, tags, links, and the deletes the API
offers. It never retries. A test case write carries its ETag (Cloud ALM
answers 428 without one).
