import { randomUUID } from 'node:crypto';

import gql from 'graphql-tag';
import { makeGraphqlApiRequest } from 'test/integration/graphql/utils/make-graphql-api-request.util';
import { generateYCombinatorAdminAccessToken } from 'test/integration/utils/generate-ycombinator-admin-access-token.util';
import { generateYCombinatorAdminApiKeyToken } from 'test/integration/utils/generate-ycombinator-admin-api-key-token.util';

// CRM-038: the search resolver is workspace-scoped like every other record
// surface. A marker string unique to this run, searched with YCombinator's
// credentials, must return none of Apple's records -- while Apple's own
// token finds its own record by the same marker, so an empty result for
// YCombinator is isolation and not a search that never returns anything.
const MARKER = `iso-${randomUUID()}`;
const COMPANY_NAME = `Isolation Search Co ${MARKER}`;
const SEARCH_INDEX_TIMEOUT_MS = 30_000;

const searchQuery = gql`
  query SearchForMarker($q: String!) {
    search(searchInput: $q, limit: 30) {
      edges {
        node {
          recordId
          objectNameSingular
        }
      }
    }
  }
`;

const searchFor = async (query: string, token?: string) => {
  const response = await makeGraphqlApiRequest(
    { query: searchQuery, variables: { q: query } },
    token,
  );

  expect(response.body.errors).toBeUndefined();

  return (response.body.data?.search?.edges ?? []).map(
    (edge: { node: { recordId: string } }) => edge.node.recordId,
  );
};

describe('cross-workspace isolation: search', () => {
  let companyId: string;
  let ycAccessToken: string;
  let ycApiKeyToken: string;

  beforeAll(async () => {
    [ycAccessToken, ycApiKeyToken] = await Promise.all([
      generateYCombinatorAdminAccessToken(),
      generateYCombinatorAdminApiKeyToken(),
    ]);

    const created = await makeGraphqlApiRequest({
      query: gql`
        mutation CreateIsolationSearchCompany($name: String!) {
          createCompany(data: { name: $name }) {
            id
          }
        }
      `,
      variables: { name: COMPANY_NAME },
    });

    expect(created.body.errors).toBeUndefined();
    companyId = created.body.data.createCompany.id;
  });

  afterAll(async () => {
    await makeGraphqlApiRequest({
      query: gql`
        mutation DestroyIsolationSearchCompany($id: UUID!) {
          destroyCompany(id: $id) {
            id
          }
        }
      `,
      variables: { id: companyId },
    });
  });

  it("finds Apple's own record with Apple's token, and none of it with YCombinator's credentials", async () => {
    const deadline = Date.now() + SEARCH_INDEX_TIMEOUT_MS;
    let ownHits: string[] = [];

    while (Date.now() < deadline) {
      ownHits = await searchFor(MARKER);
      if (ownHits.includes(companyId)) break;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    expect(ownHits).toContain(companyId);

    for (const token of [ycAccessToken, ycApiKeyToken]) {
      const foreignHits = await searchFor(MARKER, token);

      expect(foreignHits).not.toContain(companyId);
      expect(foreignHits).toEqual([]);
    }
  });
});
