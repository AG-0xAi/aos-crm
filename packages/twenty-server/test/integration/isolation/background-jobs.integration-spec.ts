import { randomUUID } from 'node:crypto';

import {
  activateCoreWorkflowVersion,
  coreWorkflowGraphqlRequest,
  createCoreWorkflow,
  createCoreWorkflowVersionStep,
  deleteCoreWorkflows,
  runCoreWorkflowVersion,
  updateCoreWorkflowVersionTrigger,
} from 'test/integration/graphql/suites/workflow/utils/core-workflow.util';
import { generateYCombinatorAdminAccessToken } from 'test/integration/utils/generate-ycombinator-admin-access-token.util';
import { generateYCombinatorAdminApiKeyToken } from 'test/integration/utils/generate-ycombinator-admin-api-key-token.util';
import { waitForAllJobsToFinish } from 'test/integration/utils/wait-for-all-jobs-to-finish.util';

// CRM-038: a manual-trigger run enqueues the real RunWorkflowJob on the
// workflow queue (CoreWorkflowRunnerService.run), the normal path a
// background job reaches a workspace's schema. This proves the row that
// job writes -- the WorkflowRun itself -- lives only in Apple's schema:
// invisible even to a direct, explicit query for it from YCombinator, and
// present once drained when queried with Apple's own credential.
const MARKER = `iso-${randomUUID()}`;

const countRunsForVersionAs = async (
  coreWorkflowVersionId: string,
  token?: string,
): Promise<number> => {
  const result = await coreWorkflowGraphqlRequest<{
    workflowRuns: { edges: { node: { id: string } }[] };
  }>({
    query: `
      query ($coreWorkflowVersionId: UUID!) {
        workflowRuns(filter: { coreWorkflowVersionId: { eq: $coreWorkflowVersionId } }) {
          edges { node { id } }
        }
      }
    `,
    variables: { coreWorkflowVersionId },
    token,
  });

  return result.workflowRuns.edges.length;
};

describe('cross-workspace isolation: background jobs', () => {
  let ycAccessToken: string;
  let ycApiKeyToken: string;
  let coreWorkflowId: string;
  let coreWorkflowVersionId: string;

  beforeAll(async () => {
    [ycAccessToken, ycApiKeyToken] = await Promise.all([
      generateYCombinatorAdminAccessToken(),
      generateYCombinatorAdminApiKeyToken(),
    ]);

    const createdWorkflow = await createCoreWorkflow({
      name: `Isolation background job workflow ${MARKER}`,
    });

    coreWorkflowId = createdWorkflow.coreWorkflowId;
    coreWorkflowVersionId = createdWorkflow.coreWorkflowVersionId;

    await updateCoreWorkflowVersionTrigger({
      coreWorkflowVersionId,
      trigger: {
        name: 'Manual Trigger',
        type: 'MANUAL',
        settings: { outputSchema: {} },
        nextStepIds: [],
        position: { x: 0, y: 0 },
      },
    });

    await createCoreWorkflowVersionStep({
      coreWorkflowVersionId,
      stepType: 'SEND_EMAIL',
    });

    await activateCoreWorkflowVersion({ coreWorkflowVersionId });
  });

  afterAll(async () => {
    await deleteCoreWorkflows({ coreWorkflowIds: [coreWorkflowId] });
  });

  it("A's manual run enqueues the real background job, writes its WorkflowRun only to Apple's schema, and it stays invisible to YCombinator", async () => {
    const runsBeforeForYc = await Promise.all(
      [ycAccessToken, ycApiKeyToken].map((token) =>
        countRunsForVersionAs(coreWorkflowVersionId, token),
      ),
    );

    expect(runsBeforeForYc).toEqual([0, 0]);

    const workflowRunId = await runCoreWorkflowVersion({
      coreWorkflowVersionId,
    });

    expect(workflowRunId).toBeDefined();

    await waitForAllJobsToFinish();

    const ownRunsAfter = await countRunsForVersionAs(coreWorkflowVersionId);

    expect(ownRunsAfter).toBe(1);

    for (const token of [ycAccessToken, ycApiKeyToken]) {
      const runsForYc = await countRunsForVersionAs(
        coreWorkflowVersionId,
        token,
      );

      expect(runsForYc).toBe(0);
    }
  });
});
