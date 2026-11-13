# CRM-038: cross-workspace isolation, proven in CI with two real workspaces

All suites below live under `packages/twenty-server/test/integration/isolation/`, run as
`*.integration-spec.ts` in the fork's `server-integration-test` CI shards. Every suite mints real
credentials for a seeded member of YCombinator (the "foreign" workspace,
`generate-ycombinator-admin-access-token.util.ts` / `generate-ycombinator-admin-api-key-token.util.ts`)
and uses no mock of any guard, resolver or repository. Every negative call has a positive twin with
Apple's own credential on the same id.

Shared assertion helper: `utils/expect-no-leak.util.ts` (`expectNoLeak`) checks that a foreign
record's id, name and `iso-<uuid>` marker are all absent from the whole serialized response body,
not just a single field.

## Records, metadata, search

| Surface | Endpoint / tool | Test file | Test name (abridged) | Positive | Negative |
| --- | --- | --- | --- | --- | --- |
| REST record by id | `GET /rest/companies/:id` | `records.integration-spec.ts` | "REST: ... cannot read Apple's company by id" | Apple's token: 200, full record | YCombinator's token/API key: 4xx, no leak in body |
| REST record by filter | `GET /rest/people?filter=id[eq]:...` | `records.integration-spec.ts` | "REST: ... cannot find Apple's person by filter on its id" | Apple: 1 result | YCombinator: 200, empty array |
| REST update/delete | `PATCH`/`DELETE /rest/companies/:id` | `records.integration-spec.ts` | "REST: ... cannot update or delete Apple's company" | n/a (checked via re-read) | YCombinator: 4xx both; record unchanged after |
| GraphQL record by id | `/graphql` `company`, `updateCompany`, `deleteCompany`, `destroyCompany` | `records.integration-spec.ts` | "GraphQL: ... cannot query, update, delete or destroy Apple's company by id" | Apple: record returned | YCombinator: null/no leak on read; GraphQL errors on every mutation; record unchanged |
| GraphQL Note by id | `/graphql` `note`, `updateNote`, `destroyNote` | `records.integration-spec.ts` | "GraphQL: ... cannot read, update or delete Apple's note" | Apple: note returned | YCombinator: null/no leak; errors on mutations; note unchanged |
| GraphQL marker filter | `/graphql` `companies(filter: name ilike marker)` | `records.integration-spec.ts` | "GraphQL: ... find none of Apple's records when filtering by the shared marker" | n/a | YCombinator: empty edges |
| Metadata object by id | `/metadata` `object(id)` | `metadata.integration-spec.ts` | "... cannot read Apple's company object metadata by id" | Apple: object returned | YCombinator: null; not present in `objects` listing either |
| Metadata view by id | `/metadata` `getView`, `updateView`, `deleteView` | `metadata.integration-spec.ts` | "... cannot read Apple's view by id" / "... cannot update or delete Apple's view" | Apple: view returned | YCombinator: null/no leak on read; errors on mutations; view unchanged |
| GraphQL dashboard | `/graphql` `dashboard`, `updateDashboard`, `destroyDashboard` | `metadata.integration-spec.ts` | "... cannot read, update or delete Apple's dashboard" | Apple: dashboard returned | YCombinator: null/no leak; errors on mutations; dashboard unchanged |
| Search (Company, Person, Note) | `/graphql` `search` resolver | `search.integration-spec.ts` | "finds Apple's own records with Apple's token, and none of it with YCombinator's credentials" | Apple: all three hit by marker (polled up to 30s, fails fast on a persistent error) | YCombinator: empty edges for both token and API key |

## Files

| Surface | Endpoint | Test file | Test name (abridged) | Positive | Negative |
| --- | --- | --- | --- | --- | --- |
| File by id, unsigned path | `GET /file/:fileFolder/:id` | `files.integration-spec.ts` | "downloads with Apple's own signed URL, and is refused for every credential on the unsigned path" | Apple's signed URL: 200, content matches marker | No credential / YCombinator token / YCombinator API key on the unsigned path: all 4xx |
| Upload by id | `PUT /files/upload/:id` (`file-upload.controller.ts`) | `files.integration-spec.ts` | "YCombinator's real upload attempt into Apple's folder, through the upload controller, is refused and Apple's file is unchanged" | n/a (checked via re-read) | YCombinator's own signed upload token, Apple's fileId substituted in: refused; `completeFileUpload` on Apple's fileId with YCombinator's credential: GraphQL error; Apple's file unchanged after |
| Attachment record | `/graphql` `attachment` | `files.integration-spec.ts` | "... cannot read Apple's attachment record, and Apple's own token can" | Apple: attachment returned | YCombinator: null |
| Record export | `GET /file/record-export/:id?token=...` | `files.integration-spec.ts` | "Apple's export downloads with Apple's own credential, and is refused for YCombinator's credentials on the same signed path" | Apple's credential on Apple's signed path: 200 | YCombinator token/API key and no credential, same signed path: all 4xx |
| Public assets route | `GET ${ApiPath.PublicAssets}/:workspaceId/:applicationId/*path` | not tested | — | — | Not an isolation surface: the route is deliberately public by design (`PublicEndpointGuard`, no credential at all), addressed explicitly by `workspaceId` + `applicationId` + path for branding/OAuth-page assets. The only real risk there is path traversal, already guarded by `validateFilePath` against `FileFolder.PublicAsset` — a separate concern from cross-workspace credential isolation, and one this suite's "no literal attack strings" rule rightly keeps out of scope. |

## Workflows

| Surface | Endpoint | Test file | Test name (abridged) | Positive | Negative |
| --- | --- | --- | --- | --- | --- |
| Read version | `/graphql` `coreWorkflowVersionById` | `workflows.integration-spec.ts` | "... cannot read Apple's workflow version by id, and Apple's own token can" | Apple: version returned, ACTIVE | YCombinator: null |
| Run via core workflow API | `/graphql` `runCoreWorkflowVersion` | `workflows.integration-spec.ts` | "... cannot run Apple's workflow version through the core workflow GraphQL API" | n/a (checked via run count) | YCombinator: refused unconditionally (GraphQL error or no runId); run count unchanged for both attempts, re-checked after draining the queue |
| Deactivate / delete | `/graphql` `deactivateCoreWorkflowVersion`, `deleteCoreWorkflows` | `workflows.integration-spec.ts` | "... cannot deactivate or delete Apple's workflow, which stays active" | n/a (checked via re-read) | YCombinator: GraphQL error on both; version still ACTIVE after |
| Update trigger / activate | `/graphql` `updateCoreWorkflowVersionTrigger`, `activateCoreWorkflowVersion` | `workflows.integration-spec.ts` | "... cannot update Apple's workflow trigger or re-activate its version through GraphQL, which stay unchanged" | n/a (checked via re-read) | YCombinator: GraphQL error on both; trigger and status unchanged |
| Webhook trigger, GET and POST | `GET`/`POST /webhooks/workflows/:workspaceId/:workflowId` | `workflows.integration-spec.ts` | "the webhook trigger addressed to YCombinator's workspace id does not run Apple's workflow, on GET or POST, and Apple's own workspace id does" | Apple's workspace id, GET: 200, run created | YCombinator's workspace id with Apple's workflow id, GET and POST: 4xx; run count unchanged after draining the queue |
| Background job (run queue) | `RunWorkflowJob` on `MessageQueue.workflowQueue`, reached via `runCoreWorkflowVersion` (manual trigger) | `background-jobs.integration-spec.ts` | "A's manual run enqueues the real background job, writes its WorkflowRun only to Apple's schema, and it stays invisible to YCombinator" | Apple's own credential, after draining: run visible, count incremented | YCombinator token and API key, explicit query for that `coreWorkflowVersionId`: 0 runs, before and after the job runs |

## MCP and AI tools

| Surface | Tool | Test file | Test name (abridged) | Positive | Negative |
| --- | --- | --- | --- | --- | --- |
| Record tools | `execute_tool` → `find_many_companies`, `update_one_company`, `delete_one_company` | `mcp.integration-spec.ts` | "execute_tool: ... cannot find, update or delete Apple's company by id" | Apple: company found, name present in result | YCombinator: id/name/marker absent from whole result (`expectNoLeak`); update/delete both `success: false`; company unchanged |
| Workflow read tools | `execute_tool` → `list_workflows`, `get_workflow_current_version` | `mcp.integration-spec.ts` | "... list_workflows and get_workflow_current_version refuse YCombinator's credentials on Apple's workflow" | Apple: read succeeds | YCombinator: workflow id absent from list; read `success: false` |
| Workflow mutation tools | `execute_tool` → `update_workflow_version_trigger`, `activate_workflow_version` | `mcp.integration-spec.ts` | "execute_tool update_workflow_version_trigger and activate_workflow_version refuse YCombinator's credentials on Apple's workflow, which stays unchanged" | n/a (checked via re-read) | YCombinator: both `success: false`; trigger and status unchanged |
| Dashboard tool | `execute_tool` → `list_dashboards` | `mcp.integration-spec.ts` | "... list_dashboards does not surface Apple's dashboard to YCombinator" | Apple: title present | YCombinator: title absent |
| View tool | `execute_tool` → `get_views` | `mcp.integration-spec.ts` | "... get_views does not surface Apple's view to YCombinator" | Apple: name present | YCombinator: name absent |
| Skills | `list_skills`, `load_skills` (direct `tools/call`, not wrapped by `execute_tool`) | `mcp.integration-spec.ts` | "list_skills and load_skills do not surface Apple's custom skill to YCombinator" | Apple: skill name listed | YCombinator: name absent from `list_skills`; `load_skills` by name returns zero skills, no label leak |

## Background jobs

Covered above under Workflows (`background-jobs.integration-spec.ts`) — the only background job this
beta's workflow surface exercises end to end through the real BullMQ queue in the integration
environment without extra OAuth-channel fixtures.

## CODE steps (logic functions)

| Surface | Endpoint | Test file | Test name (abridged) | Positive | Negative |
| --- | --- | --- | --- | --- | --- |
| Find by id | `/metadata` `findOneLogicFunction` | `code-steps.integration-spec.ts` | "... cannot find Apple's logic function by id, and Apple's own token can" | Apple: function returned | YCombinator: GraphQL error |
| Invoke by id | `/metadata` `executeOneLogicFunction` | `code-steps.integration-spec.ts` | "... cannot invoke Apple's logic function by id, and Apple's own token can" | n/a (checked via re-read) | YCombinator: GraphQL error on execution; function still findable by Apple afterward |

`LOGIC_FUNCTION_TYPE=LOCAL` in `.env.test`, so execution is reachable in the integration
environment (not `DISABLED`) and this covers the real invocation path, not only the management
surface.

## Running locally

Run against the real integration setup from this worktree (Postgres 18, Redis and ClickHouse via
Docker, matching `.github/workflows/ci-server.yaml`'s `server-integration-test` job):

```
cd packages/twenty-server
NODE_ENV=test NODE_OPTIONS="--max-old-space-size=6144" \
  npx jest --config ./jest-integration.config.ts test/integration/isolation/
```

All 8 suites, 29 tests, pass together (`Test Suites: 8 passed, 8 total`, `Tests: 29 passed, 29 total`).
Running each suite against this stack caught three issues the prior checkpoint's claim of a
"records suite green" did not surface, fixed in this run (see the worker report for commits):

- `search.integration-spec.ts` only waited for one of the three markers to index, and Person's
  last name was hyphen-joined with the marker, which Postgres's text search parser tokenizes
  differently from the marker alone -- so Person never matched a search for the marker by itself.
- `files.integration-spec.ts` uploaded into `FileFolder.FilesField` without the `fieldMetadataId`
  that folder requires (`file-upload.service.ts`'s `resolveUploadLocation`), and the record export
  test needed `FeatureFlagKey.IS_ASYNC_CSV_EXPORT_ENABLED` enabled for Apple's workspace, both
  silently assumed rather than verified in the prior checkpoint.
- `workflows.integration-spec.ts`'s `deleteCoreWorkflows` on a foreign id answers with an empty
  list, not a GraphQL error (a no-op is isolation too); the test asserted an error unconditionally
  and failed on a safe response shape it had never actually run against the server to check.
- `mcp.integration-spec.ts`'s workflow fixture needed a step before `activateCoreWorkflowVersion`
  would accept it; its `beforeAll` never exercised the real activation path before this run.

`oxfmt --check` and `oxlint --type-aware` are clean on every touched file; `corepack yarn nx
affected -t typecheck --base=origin/betty/factory` reports zero `error TS` lines. The PR's CI
(`server-integration-test` shards) remains the source of truth for the fork and must be green
before merge.
