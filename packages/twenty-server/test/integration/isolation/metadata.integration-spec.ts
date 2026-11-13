import { randomUUID } from 'node:crypto';

import gql from 'graphql-tag';
import { makeGraphqlApiRequest } from 'test/integration/graphql/utils/make-graphql-api-request.util';
import { makeMetadataApiRequest } from 'test/integration/metadata/suites/utils/make-metadata-api-request.util';
import { generateYCombinatorAdminAccessToken } from 'test/integration/utils/generate-ycombinator-admin-access-token.util';
import {
  generateYCombinatorAdminApiKeyToken,
  revokeYCombinatorAdminApiKeys,
} from 'test/integration/utils/generate-ycombinator-admin-api-key-token.util';
import { expectNoLeak } from 'test/integration/isolation/utils/expect-no-leak.util';
import { ViewType } from 'twenty-shared/types';

// CRM-038: object metadata, views and dashboards each belong to one
// workspace. YCombinator's credentials must not read Apple's object
// metadata by id, and must not read, update or delete Apple's view or
// dashboard -- with Apple's own credential succeeding on the same calls.
const MARKER = `iso-${randomUUID()}`;

describe('cross-workspace isolation: metadata (objects, views, dashboards)', () => {
  let ycAccessToken: string;
  let ycApiKeyToken: string;
  let companyObjectMetadataId: string;
  let viewId: string;
  const viewName = `Isolation View ${MARKER}`;
  let dashboardId: string;
  const dashboardTitle = `Isolation Dashboard ${MARKER}`;

  beforeAll(async () => {
    [ycAccessToken, ycApiKeyToken] = await Promise.all([
      generateYCombinatorAdminAccessToken(),
      generateYCombinatorAdminApiKeyToken(),
    ]);

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

    expect(objects.body.errors).toBeUndefined();
    const companyObject = objects.body.data.objects.edges.find(
      (edge: { node: { nameSingular: string } }) =>
        edge.node.nameSingular === 'company',
    );

    expect(companyObject).toBeDefined();
    companyObjectMetadataId = companyObject.node.id;

    const createdView = await makeMetadataApiRequest({
      query: gql`
        mutation CreateIsolationView($input: CreateViewInput!) {
          createView(input: $input) {
            id
            name
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

    const createdDashboard = await makeGraphqlApiRequest({
      query: gql`
        mutation CreateIsolationDashboard($title: String!) {
          createDashboard(data: { title: $title }) {
            id
            title
          }
        }
      `,
      variables: { title: dashboardTitle },
    });

    expect(createdDashboard.body.errors).toBeUndefined();
    dashboardId = createdDashboard.body.data.createDashboard.id;
  });

  afterAll(async () => {
    await revokeYCombinatorAdminApiKeys();

    await makeMetadataApiRequest({
      query: gql`
        mutation DestroyIsolationView($id: String!) {
          destroyView(id: $id)
        }
      `,
      variables: { id: viewId },
    });

    await makeGraphqlApiRequest({
      query: gql`
        mutation DestroyIsolationDashboard($id: UUID!) {
          destroyDashboard(id: $id) {
            id
          }
        }
      `,
      variables: { id: dashboardId },
    });
  });

  it("YCombinator's credentials cannot read Apple's company object metadata by id, and Apple's own token can", async () => {
    const own = await makeMetadataApiRequest({
      query: gql`
        query FindIsolationObject($id: UUID!) {
          object(id: $id) {
            id
            nameSingular
          }
        }
      `,
      variables: { id: companyObjectMetadataId },
    });

    expect(own.body.errors).toBeUndefined();
    expect(own.body.data.object?.id).toBe(companyObjectMetadataId);

    for (const token of [ycAccessToken, ycApiKeyToken]) {
      const foreign = await makeMetadataApiRequest(
        {
          query: gql`
            query FindIsolationObject($id: UUID!) {
              object(id: $id) {
                id
                nameSingular
              }
            }
          `,
          variables: { id: companyObjectMetadataId },
        },
        token,
      );

      expect(foreign.body.data?.object ?? null).toBeNull();

      const objectList = await makeMetadataApiRequest(
        {
          query: gql`
            query {
              objects(paging: { first: 200 }) {
                edges {
                  node {
                    id
                  }
                }
              }
            }
          `,
        },
        token,
      );

      const ids = objectList.body.data.objects.edges.map(
        (edge: { node: { id: string } }) => edge.node.id,
      );

      expect(ids).not.toContain(companyObjectMetadataId);
    }
  });

  it("YCombinator's credentials cannot read Apple's view by id, and Apple's own token can", async () => {
    const own = await makeMetadataApiRequest({
      query: gql`
        query FindIsolationView($id: String!) {
          getView(id: $id) {
            id
            name
          }
        }
      `,
      variables: { id: viewId },
    });

    expect(own.body.errors).toBeUndefined();
    expect(own.body.data.getView?.name).toBe(viewName);

    for (const token of [ycAccessToken, ycApiKeyToken]) {
      const foreign = await makeMetadataApiRequest(
        {
          query: gql`
            query FindIsolationView($id: String!) {
              getView(id: $id) {
                id
                name
              }
            }
          `,
          variables: { id: viewId },
        },
        token,
      );

      expect(foreign.body.data?.getView ?? null).toBeNull();
      expectNoLeak(foreign.body, {
        id: viewId,
        name: viewName,
        marker: MARKER,
      });
    }
  });

  it("YCombinator's credentials cannot update or delete Apple's view, which stays intact", async () => {
    for (const token of [ycAccessToken, ycApiKeyToken]) {
      const updated = await makeMetadataApiRequest(
        {
          query: gql`
            mutation UpdateIsolationView(
              $id: String!
              $input: UpdateViewInput!
            ) {
              updateView(id: $id, input: $input) {
                id
              }
            }
          `,
          variables: { id: viewId, input: { name: 'tampered by YCombinator' } },
        },
        token,
      );

      expect(updated.body.errors).toBeDefined();

      const deleted = await makeMetadataApiRequest(
        {
          query: gql`
            mutation DeleteIsolationView($id: String!) {
              deleteView(id: $id)
            }
          `,
          variables: { id: viewId },
        },
        token,
      );

      expect(deleted.body.errors).toBeDefined();
    }

    const stillOwned = await makeMetadataApiRequest({
      query: gql`
        query FindIsolationView($id: String!) {
          getView(id: $id) {
            id
            name
            deletedAt
          }
        }
      `,
      variables: { id: viewId },
    });

    expect(stillOwned.body.data.getView.name).toBe(viewName);
    expect(stillOwned.body.data.getView.deletedAt).toBeNull();
  });

  it("YCombinator's credentials cannot read, update or delete Apple's dashboard, which stays intact", async () => {
    const own = await makeGraphqlApiRequest({
      query: gql`
        query FindIsolationDashboard($filter: DashboardFilterInput!) {
          dashboard(filter: $filter) {
            id
            title
          }
        }
      `,
      variables: { filter: { id: { eq: dashboardId } } },
    });

    expect(own.body.data.dashboard?.title).toBe(dashboardTitle);

    for (const token of [ycAccessToken, ycApiKeyToken]) {
      const foreignRead = await makeGraphqlApiRequest(
        {
          query: gql`
            query FindIsolationDashboard($filter: DashboardFilterInput!) {
              dashboard(filter: $filter) {
                id
                title
              }
            }
          `,
          variables: { filter: { id: { eq: dashboardId } } },
        },
        token,
      );

      expect(foreignRead.body.data?.dashboard ?? null).toBeNull();
      expectNoLeak(foreignRead.body, {
        id: dashboardId,
        name: dashboardTitle,
        marker: MARKER,
      });

      const updated = await makeGraphqlApiRequest(
        {
          query: gql`
            mutation ($id: UUID!) {
              updateDashboard(id: $id, data: { title: "tampered" }) {
                id
              }
            }
          `,
          variables: { id: dashboardId },
        },
        token,
      );

      expect(updated.body.errors).toBeDefined();

      const destroyed = await makeGraphqlApiRequest(
        {
          query: gql`
            mutation ($id: UUID!) {
              destroyDashboard(id: $id) {
                id
              }
            }
          `,
          variables: { id: dashboardId },
        },
        token,
      );

      expect(destroyed.body.errors).toBeDefined();
    }

    const stillOwned = await makeGraphqlApiRequest({
      query: gql`
        query FindIsolationDashboard($filter: DashboardFilterInput!) {
          dashboard(filter: $filter) {
            id
            title
            deletedAt
          }
        }
      `,
      variables: { filter: { id: { eq: dashboardId } } },
    });

    expect(stillOwned.body.data.dashboard.title).toBe(dashboardTitle);
    expect(stillOwned.body.data.dashboard.deletedAt).toBeNull();
  });
});
