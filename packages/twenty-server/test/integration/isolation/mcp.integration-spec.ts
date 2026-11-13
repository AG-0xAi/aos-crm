import { randomUUID } from 'node:crypto';

import gql from 'graphql-tag';
import request from 'supertest';
import { executeToolThroughMcp } from 'test/integration/ai/utils/execute-tool-through-mcp.util';
import { makeGraphqlApiRequest } from 'test/integration/graphql/utils/make-graphql-api-request.util';
import {
  activateCoreWorkflowVersion,
  createCoreWorkflow,
  findCoreWorkflowVersion,
  updateCoreWorkflowVersionTrigger,
} from 'test/integration/graphql/suites/workflow/utils/core-workflow.util';
import { createSkill } from 'test/integration/metadata/suites/skill/utils/create-skill.util';
import { deleteSkill } from 'test/integration/metadata/suites/skill/utils/delete-skill.util';
import { makeMetadataApiRequest } from 'test/integration/metadata/suites/utils/make-metadata-api-request.util';
import { generateYCombinatorAdminAccessToken } from 'test/integration/utils/generate-ycombinator-admin-access-token.util';
import { generateYCombinatorAdminApiKeyToken } from 'test/integration/utils/generate-ycombinator-admin-api-key-token.util';
import { expectNoLeak } from 'test/integration/isolation/utils/expect-no-leak.util';
import { ViewType } from 'twenty-shared/types';

// CRM-038: the MCP execute_tool surface (/mcp, tools/call) reuses the same
// workspace-scoped services as GraphQL and REST. This checks the generic
// record tools (companies), the dedicated workflow tools and the dedicated
// view/dashboard tools all refuse YCombinator's credentials on Apple's
// ids, with Apple's own credential succeeding on the same ids and ids.
const MARKER = `iso-${randomUUID()}`;

const callMcpToolDirect = async (
  toolName: string,
  toolArguments: object,
  token: string,
): Promise<{ result?: Record<string, unknown>; isError?: boolean }> => {
  const response = await request(`http://localhost:${APP_PORT}`)
    .post('/mcp')
    .set('Authorization', `Bearer ${token}`)
    .set('Content-Type', 'application/json')
    .set('Accept', 'application/json')
    .send(
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/call',
        id: `call-${randomUUID()}`,
        params: { name: toolName, arguments: toolArguments },
      }),
    )
    .expect(200);

  const text = response.body.result?.content?.[0]?.text;

  return {
    result: text ? JSON.parse(text) : undefined,
    isError: response.body.result?.isError,
  };
};

describe('cross-workspace isolation: MCP tools', () => {
  let ycAccessToken: string;
  let ycApiKeyToken: string;
  let companyId: string;
  const companyName = `Isolation MCP Co ${MARKER}`;
  let coreWorkflowId: string;
  let coreWorkflowVersionId: string;
  let dashboardId: string;
  const dashboardTitle = `Isolation MCP Dashboard ${MARKER}`;
  let viewId: string;
  const viewName = `Isolation MCP View ${MARKER}`;
  let skillId: string;
  const skillName = `isolationMcpSkill${MARKER.replace(/-/g, '')}`;
  const skillLabel = `Isolation MCP Skill ${MARKER}`;

  beforeAll(async () => {
    [ycAccessToken, ycApiKeyToken] = await Promise.all([
      generateYCombinatorAdminAccessToken(),
      generateYCombinatorAdminApiKeyToken(),
    ]);

    const createdCompany = await makeGraphqlApiRequest({
      query: gql`
        mutation ($name: String!) {
          createCompany(data: { name: $name }) {
            id
          }
        }
      `,
      variables: { name: companyName },
    });

    expect(createdCompany.body.errors).toBeUndefined();
    companyId = createdCompany.body.data.createCompany.id;

    const createdWorkflow = await createCoreWorkflow({
      name: `Isolation MCP workflow ${MARKER}`,
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

    await activateCoreWorkflowVersion({ coreWorkflowVersionId });

    const createdDashboard = await makeGraphqlApiRequest({
      query: gql`
        mutation ($title: String!) {
          createDashboard(data: { title: $title }) {
            id
          }
        }
      `,
      variables: { title: dashboardTitle },
    });

    expect(createdDashboard.body.errors).toBeUndefined();
    dashboardId = createdDashboard.body.data.createDashboard.id;

    const objects = await makeMetadataApiRequest({
      query: gql`
        query {
          objects(paging: { first: 200 }) {
            edges {
              node {
                id
                nameSingular
              }
            }
          }
        }
      `,
    });

    const companyObjectMetadataId = objects.body.data.objects.edges.find(
      (edge: { node: { nameSingular: string } }) =>
        edge.node.nameSingular === 'company',
    ).node.id;

    const createdView = await makeMetadataApiRequest({
      query: gql`
        mutation ($input: CreateViewInput!) {
          createView(input: $input) {
            id
          }
        }
      `,
      variables: {
        input: {
          name: viewName,
          objectMetadataId: companyObjectMetadataId,
          icon: 'IconTable',
          type: ViewType.TABLE,
        },
      },
    });

    expect(createdView.body.errors).toBeUndefined();
    viewId = createdView.body.data.createView.id;

    const createdSkill = await createSkill({
      expectToFail: false,
      input: {
        name: skillName,
        label: skillLabel,
        content: `Isolation MCP skill content ${MARKER}`,
      },
    });

    skillId = createdSkill.data.createSkill.id;
  });

  afterAll(async () => {
    await deleteSkill({ expectToFail: false, input: { id: skillId } });

    await makeGraphqlApiRequest({
      query: gql`
        mutation ($companyId: UUID!, $dashboardId: UUID!) {
          destroyCompany(id: $companyId) {
            id
          }
          destroyDashboard(id: $dashboardId) {
            id
          }
        }
      `,
      variables: { companyId, dashboardId },
    });
    await makeMetadataApiRequest({
      query: gql`
        mutation ($id: String!) {
          destroyView(id: $id)
        }
      `,
      variables: { id: viewId },
    });
  });

  it("execute_tool: YCombinator's credentials cannot find, update or delete Apple's company by id", async () => {
    const own = await executeToolThroughMcp({
      toolName: 'find_many_companies',
      toolArguments: {
        id: { eq: companyId },
        select: ['id', 'name'],
        limit: 5,
      },
      token: APPLE_JANE_ADMIN_ACCESS_TOKEN,
    });

    expect(own.success).toBe(true);
    expect(JSON.stringify(own.result)).toContain(companyName);

    for (const token of [ycAccessToken, ycApiKeyToken]) {
      const foreignRead = await executeToolThroughMcp({
        toolName: 'find_many_companies',
        toolArguments: {
          id: { eq: companyId },
          select: ['id', 'name'],
          limit: 5,
        },
        token,
      });

      expectNoLeak(foreignRead.result, {
        id: companyId,
        name: companyName,
        marker: MARKER,
      });

      const update = await executeToolThroughMcp({
        toolName: 'update_one_company',
        toolArguments: { id: companyId, name: 'tampered by YCombinator' },
        token,
      });

      expect(update.success).toBe(false);

      const destroy = await executeToolThroughMcp({
        toolName: 'delete_one_company',
        toolArguments: { id: companyId },
        token,
      });

      expect(destroy.success).toBe(false);
    }

    const stillOwned = await executeToolThroughMcp({
      toolName: 'find_many_companies',
      toolArguments: {
        id: { eq: companyId },
        select: ['id', 'name'],
        limit: 5,
      },
      token: APPLE_JANE_ADMIN_ACCESS_TOKEN,
    });

    expect(JSON.stringify(stillOwned.result)).toContain(companyName);
  });

  it("execute_tool list_workflows and get_workflow_current_version refuse YCombinator's credentials on Apple's workflow", async () => {
    for (const token of [ycAccessToken, ycApiKeyToken]) {
      const listed = await executeToolThroughMcp({
        toolName: 'list_workflows',
        toolArguments: { limit: 100 },
        token,
      });

      const workflowIds = (
        (listed.result as { workflows?: { id: string }[] } | undefined)
          ?.workflows ?? []
      ).map((workflow) => workflow.id);

      expect(workflowIds).not.toContain(coreWorkflowId);

      const read = await executeToolThroughMcp({
        toolName: 'get_workflow_current_version',
        toolArguments: { coreWorkflowId },
        token,
      });

      expect(read.success).toBe(false);
    }

    const ownRead = await executeToolThroughMcp({
      toolName: 'get_workflow_current_version',
      toolArguments: { coreWorkflowId },
      token: APPLE_JANE_ADMIN_ACCESS_TOKEN,
    });

    expect(ownRead.success).toBe(true);
  });

  it("execute_tool list_dashboards does not surface Apple's dashboard to YCombinator", async () => {
    for (const token of [ycAccessToken, ycApiKeyToken]) {
      const listed = await executeToolThroughMcp({
        toolName: 'list_dashboards',
        toolArguments: { limit: 100 },
        token,
      });

      const titles = JSON.stringify(listed.result ?? '');

      expect(titles).not.toContain(dashboardTitle);
    }

    const own = await executeToolThroughMcp({
      toolName: 'list_dashboards',
      toolArguments: { limit: 100 },
      token: APPLE_JANE_ADMIN_ACCESS_TOKEN,
    });

    expect(JSON.stringify(own.result)).toContain(dashboardTitle);
  });

  it("execute_tool get_views does not surface Apple's view to YCombinator", async () => {
    for (const token of [ycAccessToken, ycApiKeyToken]) {
      const listed = await executeToolThroughMcp({
        toolName: 'get_views',
        toolArguments: { objectNameSingular: 'company', limit: 100 },
        token,
      });

      const names = JSON.stringify(listed.result ?? '');

      expect(names).not.toContain(viewName);
    }

    const own = await executeToolThroughMcp({
      toolName: 'get_views',
      toolArguments: { objectNameSingular: 'company', limit: 100 },
      token: APPLE_JANE_ADMIN_ACCESS_TOKEN,
    });

    expect(JSON.stringify(own.result)).toContain(viewName);
  });

  it("execute_tool update_workflow_version_trigger and activate_workflow_version refuse YCombinator's credentials on Apple's workflow, which stays unchanged", async () => {
    const before = await findCoreWorkflowVersion({ coreWorkflowVersionId });

    for (const token of [ycAccessToken, ycApiKeyToken]) {
      const updated = await executeToolThroughMcp({
        toolName: 'update_workflow_version_trigger',
        toolArguments: {
          coreWorkflowVersionId,
          trigger: {
            name: 'tampered by YCombinator',
            type: 'WEBHOOK',
            settings: {
              outputSchema: {},
              httpMethod: 'POST',
              authentication: null,
            },
            nextStepIds: [],
            position: { x: 0, y: 0 },
          },
        },
        token,
      });

      expect(updated.success).toBe(false);

      const activated = await executeToolThroughMcp({
        toolName: 'activate_workflow_version',
        toolArguments: { coreWorkflowVersionId },
        token,
      });

      expect(activated.success).toBe(false);
    }

    const after = await findCoreWorkflowVersion({ coreWorkflowVersionId });

    expect(after.trigger).toEqual(before.trigger);
    expect(after.status).toBe(before.status);
  });

  it("list_skills and load_skills do not surface Apple's custom skill to YCombinator", async () => {
    for (const token of [ycAccessToken, ycApiKeyToken]) {
      const listed = await callMcpToolDirect('list_skills', {}, token);

      expect(JSON.stringify(listed.result ?? '')).not.toContain(skillName);

      const loaded = await callMcpToolDirect(
        'load_skills',
        { skillNames: [skillName] },
        token,
      );

      expect(
        (loaded.result?.skills as unknown[] | undefined) ?? [],
      ).toHaveLength(0);
      expect(JSON.stringify(loaded.result ?? '')).not.toContain(skillLabel);
    }

    const own = await callMcpToolDirect(
      'list_skills',
      {},
      APPLE_JANE_ADMIN_ACCESS_TOKEN,
    );

    expect(JSON.stringify(own.result)).toContain(skillName);
  });
});
