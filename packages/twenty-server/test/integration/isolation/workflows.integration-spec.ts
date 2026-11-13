import { randomUUID } from 'node:crypto';

import request from 'supertest';
import {
  activateCoreWorkflowVersion,
  coreWorkflowGraphqlRequest,
  createCoreWorkflow,
  createCoreWorkflowVersionStep,
  deleteCoreWorkflows,
  findCoreWorkflowVersion,
  updateCoreWorkflowVersionTrigger,
} from 'test/integration/graphql/suites/workflow/utils/core-workflow.util';
import { generateYCombinatorAdminAccessToken } from 'test/integration/utils/generate-ycombinator-admin-access-token.util';
import { generateYCombinatorAdminApiKeyToken } from 'test/integration/utils/generate-ycombinator-admin-api-key-token.util';

import {
  SEED_APPLE_WORKSPACE_ID,
  SEED_YCOMBINATOR_WORKSPACE_ID,
} from 'src/engine/workspace-manager/dev-seeder/core/constants/seeder-workspaces.constant';

// CRM-038: a workflow is owned by one workspace end to end -- the core
// workflow GraphQL API (createCoreWorkflow/runCoreWorkflowVersion/...) and
// the public webhook trigger route both resolve the caller's workspace
// independently of the ids in the request, so YCombinator addressing
// Apple's coreWorkflowId/coreWorkflowVersionId must be refused on every
// surface, while Apple's own credential keeps working on the same ids.
//
// Whether a workspace-scoped lookup on a foreign id surfaces as a GraphQL
// error or as an empty/null result is an implementation detail this suite
// does not assume either way: rawCoreWorkflowRequest never throws, and
// every assertion checks the EFFECT (no run created, version unchanged)
// rather than the shape of the refusal.
const MARKER = `iso-${randomUUID()}`;

const rawCoreWorkflowRequest = async (
  query: string,
  variables: Record<string, unknown> = {},
  token?: string,
): Promise<{ errors?: unknown[]; data?: Record<string, unknown> }> => {
  const response = await request(`http://localhost:${APP_PORT}`)
    .post('/graphql')
    .set('Authorization', `Bearer ${token ?? APPLE_JANE_ADMIN_ACCESS_TOKEN}`)
    .send({ query, variables });

  return { errors: response.body.errors, data: response.body.data };
};

const countRunsForVersion = async (
  coreWorkflowVersionId: string,
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
  });

  return result.workflowRuns.edges.length;
};

describe('cross-workspace isolation: workflows', () => {
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
      name: `Isolation workflow ${MARKER}`,
    });

    coreWorkflowId = createdWorkflow.coreWorkflowId;
    coreWorkflowVersionId = createdWorkflow.coreWorkflowVersionId;

    await updateCoreWorkflowVersionTrigger({
      coreWorkflowVersionId,
      trigger: {
        name: 'Webhook Trigger',
        type: 'WEBHOOK',
        settings: { outputSchema: {}, httpMethod: 'GET', authentication: null },
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

  it("YCombinator's credentials cannot read Apple's workflow version by id, and Apple's own token can", async () => {
    const own = await findCoreWorkflowVersion({ coreWorkflowVersionId });

    expect(own.id).toBe(coreWorkflowVersionId);
    expect(own.status).toBe('ACTIVE');

    for (const token of [ycAccessToken, ycApiKeyToken]) {
      const foreign = await rawCoreWorkflowRequest(
        `
          query ($id: UUID!) {
            coreWorkflowVersionById(coreWorkflowVersionId: $id) { id status }
          }
        `,
        { id: coreWorkflowVersionId },
        token,
      );

      const result = foreign.data?.coreWorkflowVersionById as
        | { id: string }
        | null
        | undefined;

      expect(result ?? null).toBeNull();
    }
  });

  it("YCombinator's credentials cannot run Apple's workflow version through the core workflow GraphQL API", async () => {
    const runsBefore = await countRunsForVersion(coreWorkflowVersionId);

    for (const token of [ycAccessToken, ycApiKeyToken]) {
      const result = await rawCoreWorkflowRequest(
        `
          mutation ($input: RunCoreWorkflowVersionInput!) {
            runCoreWorkflowVersion(input: $input) { workflowRunId }
          }
        `,
        { input: { coreWorkflowVersionId } },
        token,
      );

      const runId = (
        result.data?.runCoreWorkflowVersion as { workflowRunId: string } | null
      )?.workflowRunId;

      // Either the mutation was refused outright, or it answered without
      // creating a run attributed to Apple's version -- both are isolation;
      // a 2xx that actually created the run is the leak.
      if (runId) {
        const runsAfterThisAttempt = await countRunsForVersion(
          coreWorkflowVersionId,
        );

        expect(runsAfterThisAttempt).toBe(runsBefore);
      } else {
        expect(result.errors).toBeDefined();
      }
    }

    expect(await countRunsForVersion(coreWorkflowVersionId)).toBe(runsBefore);
  });

  it("YCombinator's credentials cannot deactivate or delete Apple's workflow, which stays active", async () => {
    for (const token of [ycAccessToken, ycApiKeyToken]) {
      const deactivated = await rawCoreWorkflowRequest(
        `
          mutation ($id: UUID!) { deactivateCoreWorkflowVersion(coreWorkflowVersionId: $id) }
        `,
        { id: coreWorkflowVersionId },
        token,
      );

      expect(deactivated.errors).toBeDefined();

      const deleted = await rawCoreWorkflowRequest(
        `
          mutation ($input: DeleteCoreWorkflowsInput!) { deleteCoreWorkflows(input: $input) { id } }
        `,
        { input: { coreWorkflowIds: [coreWorkflowId] } },
        token,
      );

      expect(deleted.errors).toBeDefined();
    }

    const stillActive = await findCoreWorkflowVersion({
      coreWorkflowVersionId,
    });

    expect(stillActive.status).toBe('ACTIVE');
  });

  it("the webhook trigger addressed to YCombinator's workspace id does not run Apple's workflow, and Apple's own workspace id does", async () => {
    const runsBefore = await countRunsForVersion(coreWorkflowVersionId);

    const wrongWorkspace = await request(`http://localhost:${APP_PORT}`).get(
      `/webhooks/workflows/${SEED_YCOMBINATOR_WORKSPACE_ID}/${coreWorkflowId}`,
    );

    expect(wrongWorkspace.status).toBeGreaterThanOrEqual(400);
    expect(wrongWorkspace.status).toBeLessThan(500);
    expect(await countRunsForVersion(coreWorkflowVersionId)).toBe(runsBefore);

    const correctWorkspace = await request(`http://localhost:${APP_PORT}`).get(
      `/webhooks/workflows/${SEED_APPLE_WORKSPACE_ID}/${coreWorkflowId}`,
    );

    expect(correctWorkspace.status).toBe(200);
    expect(correctWorkspace.body.success).toBe(true);
    expect(correctWorkspace.body.workflowRunId).toBeDefined();
    expect(await countRunsForVersion(coreWorkflowVersionId)).toBe(
      runsBefore + 1,
    );
  });
});
