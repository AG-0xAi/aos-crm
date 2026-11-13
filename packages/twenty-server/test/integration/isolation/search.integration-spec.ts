import { randomUUID } from 'node:crypto';

import gql from 'graphql-tag';
import { makeGraphqlApiRequest } from 'test/integration/graphql/utils/make-graphql-api-request.util';
import { expectNoLeak } from 'test/integration/isolation/utils/expect-no-leak.util';
import { generateYCombinatorAdminAccessToken } from 'test/integration/utils/generate-ycombinator-admin-access-token.util';
import {
  generateYCombinatorAdminApiKeyToken,
  revokeYCombinatorAdminApiKeys,
} from 'test/integration/utils/generate-ycombinator-admin-api-key-token.util';

// CRM-038: the search resolver is workspace-scoped like every other record
// surface. A marker string unique to this run, searched with YCombinator's
// credentials, must return none of Apple's records -- while Apple's own
// token finds its own record by the same marker, so an empty result for
// YCombinator is isolation and not a search that never returns anything.
// Covers Company, Person and Note, so the proof isn't specific to one
// object's indexing path.
const MARKER = `iso-${randomUUID()}`;
const COMPANY_NAME = `Isolation Search Co ${MARKER}`;
// Space-separated, not hyphen-joined with MARKER: Postgres's text search
// parser tokenizes a hyphen-joined word as one lexeme distinct from MARKER
// alone, so a hyphen-joined last name would never match a search for
// MARKER by itself.
const PERSON_LAST_NAME = `Isolation Search ${MARKER}`;
const NOTE_TITLE = `Isolation Search Note ${MARKER}`;
const SEARCH_INDEX_TIMEOUT_MS = 30_000;
const SEARCH_INDEX_POLL_INTERVAL_MS = 1_000;

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

// Distinguishes "no hits yet" (worth retrying, indexing can lag) from a
// persistent GraphQL error (never worth retrying for the full timeout).
const searchForOrThrow = async (
  query: string,
  token?: string,
): Promise<string[]> => {
  const response = await makeGraphqlApiRequest(
    { query: searchQuery, variables: { q: query } },
    token,
  );

  if (response.body.errors) {
    throw new Error(
      `Search request failed: ${JSON.stringify(response.body.errors)}`,
    );
  }

  return (response.body.data?.search?.edges ?? []).map(
    (edge: { node: { recordId: string } }) => edge.node.recordId,
  );
};

const waitForOwnHits = async (recordIds: string[]): Promise<string[]> => {
  const deadline = Date.now() + SEARCH_INDEX_TIMEOUT_MS;
  let hits: string[] = [];

  while (Date.now() < deadline) {
    hits = await searchForOrThrow(MARKER);
    if (recordIds.every((recordId) => hits.includes(recordId))) {
      break;
    }
    await new Promise((resolve) =>
      setTimeout(resolve, SEARCH_INDEX_POLL_INTERVAL_MS),
    );
  }

  return hits;
};

describe('cross-workspace isolation: search', () => {
  let companyId: string;
  let personId: string;
  let noteId: string;
  let ycAccessToken: string;
  let ycApiKeyToken: string;

  beforeAll(async () => {
    [ycAccessToken, ycApiKeyToken] = await Promise.all([
      generateYCombinatorAdminAccessToken(),
      generateYCombinatorAdminApiKeyToken(),
    ]);

    const createdCompany = await makeGraphqlApiRequest({
      query: gql`
        mutation CreateIsolationSearchCompany($name: String!) {
          createCompany(data: { name: $name }) {
            id
          }
        }
      `,
      variables: { name: COMPANY_NAME },
    });

    expect(createdCompany.body.errors).toBeUndefined();
    companyId = createdCompany.body.data.createCompany.id;

    const createdPerson = await makeGraphqlApiRequest({
      query: gql`
        mutation CreateIsolationSearchPerson($lastName: String!) {
          createPerson(
            data: { name: { firstName: "Isolation", lastName: $lastName } }
          ) {
            id
          }
        }
      `,
      variables: { lastName: PERSON_LAST_NAME },
    });

    expect(createdPerson.body.errors).toBeUndefined();
    personId = createdPerson.body.data.createPerson.id;

    const createdNote = await makeGraphqlApiRequest({
      query: gql`
        mutation CreateIsolationSearchNote($title: String!) {
          createNote(data: { title: $title }) {
            id
          }
        }
      `,
      variables: { title: NOTE_TITLE },
    });

    expect(createdNote.body.errors).toBeUndefined();
    noteId = createdNote.body.data.createNote.id;
  });

  afterAll(async () => {
    await revokeYCombinatorAdminApiKeys();

    await makeGraphqlApiRequest({
      query: gql`
        mutation DestroyIsolationSearchRecords(
          $companyId: UUID!
          $personId: UUID!
          $noteId: UUID!
        ) {
          destroyCompany(id: $companyId) {
            id
          }
          destroyPerson(id: $personId) {
            id
          }
          destroyNote(id: $noteId) {
            id
          }
        }
      `,
      variables: { companyId, personId, noteId },
    });
  });

  it("finds Apple's own records with Apple's token, and none of it with YCombinator's credentials", async () => {
    const ownHits = await waitForOwnHits([companyId, personId, noteId]);

    expect(ownHits).toContain(companyId);
    expect(ownHits).toContain(personId);
    expect(ownHits).toContain(noteId);

    for (const token of [ycAccessToken, ycApiKeyToken]) {
      const foreignHits = await searchForOrThrow(MARKER, token);

      expect(foreignHits).toEqual([]);

      for (const [id, name] of [
        [companyId, COMPANY_NAME],
        [personId, PERSON_LAST_NAME],
        [noteId, NOTE_TITLE],
      ]) {
        expectNoLeak(foreignHits, { id, name, marker: MARKER });
      }
    }
  });
});
