import { randomUUID } from 'node:crypto';

import gql from 'graphql-tag';
import { makeGraphqlApiRequest } from 'test/integration/graphql/utils/make-graphql-api-request.util';
import { makeRestApiRequest } from 'test/integration/rest/utils/make-rest-api-request.util';
import { generateYCombinatorAdminAccessToken } from 'test/integration/utils/generate-ycombinator-admin-access-token.util';
import { generateYCombinatorAdminApiKeyToken } from 'test/integration/utils/generate-ycombinator-admin-api-key-token.util';
import { expectNoLeak } from 'test/integration/isolation/utils/expect-no-leak.util';

// CRM-038: a record created in Apple (the seeded workspace behind
// APPLE_JANE_ADMIN_ACCESS_TOKEN/API_KEY_ACCESS_TOKEN) must be unreachable
// from YCombinator (the OTHER seeded workspace), on both REST and GraphQL,
// with a real YCombinator user token and a real YCombinator API key -- not
// a mock of the guard, the resolver or the repository. Every negative here
// has a positive twin with Apple's own credential, so a refusal can never
// be explained by the call itself being wrong.
const MARKER = `iso-${randomUUID()}`;
const COMPANY_NAME = `Isolation Co ${MARKER}`;
const PERSON_LAST_NAME = `Isolation-${MARKER}`;

const isRefused = (status: number) => status >= 400 && status < 500;

const NOTE_TITLE = `Isolation Note ${MARKER}`;

describe('cross-workspace isolation: records (REST and GraphQL)', () => {
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
        mutation CreateIsolationCompany($name: String!) {
          createCompany(data: { name: $name }) {
            id
            name
          }
        }
      `,
      variables: { name: COMPANY_NAME },
    });

    expect(createdCompany.body.errors).toBeUndefined();
    companyId = createdCompany.body.data.createCompany.id;

    const createdPerson = await makeGraphqlApiRequest({
      query: gql`
        mutation CreateIsolationPerson($lastName: String!) {
          createPerson(
            data: { name: { firstName: "Isolation", lastName: $lastName } }
          ) {
            id
            name {
              lastName
            }
          }
        }
      `,
      variables: { lastName: PERSON_LAST_NAME },
    });

    expect(createdPerson.body.errors).toBeUndefined();
    personId = createdPerson.body.data.createPerson.id;

    const createdNote = await makeGraphqlApiRequest({
      query: gql`
        mutation CreateIsolationNote($title: String!) {
          createNote(data: { title: $title }) {
            id
            title
          }
        }
      `,
      variables: { title: NOTE_TITLE },
    });

    expect(createdNote.body.errors).toBeUndefined();
    noteId = createdNote.body.data.createNote.id;
  });

  afterAll(async () => {
    await makeGraphqlApiRequest({
      query: gql`
        mutation DestroyIsolationRecords(
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

  it("REST: YCombinator's token and API key cannot read Apple's company by id, and Apple's own token can", async () => {
    const own = await makeRestApiRequest({
      method: 'get',
      path: `/companies/${companyId}`,
    });

    expect(own.status).toBe(200);
    expect(own.body.data.company.name).toBe(COMPANY_NAME);

    for (const bearer of [ycAccessToken, ycApiKeyToken]) {
      const foreign = await makeRestApiRequest({
        method: 'get',
        path: `/companies/${companyId}`,
        bearer,
      });

      expect(isRefused(foreign.status)).toBe(true);
      expectNoLeak(foreign.body, {
        id: companyId,
        name: COMPANY_NAME,
        marker: MARKER,
      });
    }
  });

  it("REST: YCombinator's credentials cannot find Apple's person by filter on its id", async () => {
    const own = await makeRestApiRequest({
      method: 'get',
      path: `/people?filter=id[eq]:${personId}`,
    });

    expect(own.status).toBe(200);
    expect(own.body.data.people).toHaveLength(1);
    expect(own.body.data.people[0].id).toBe(personId);
    expect(JSON.stringify(own.body)).toContain(PERSON_LAST_NAME);

    for (const bearer of [ycAccessToken, ycApiKeyToken]) {
      const foreign = await makeRestApiRequest({
        method: 'get',
        path: `/people?filter=id[eq]:${personId}`,
        bearer,
      });

      expect(foreign.status).toBe(200);
      expect(foreign.body.data.people).toEqual([]);
    }
  });

  it("REST: YCombinator's credentials cannot update or delete Apple's company, and the record stays intact", async () => {
    for (const bearer of [ycAccessToken, ycApiKeyToken]) {
      const updated = await makeRestApiRequest({
        method: 'patch',
        path: `/companies/${companyId}`,
        bearer,
        body: { name: 'tampered by YCombinator' },
      });

      expect(isRefused(updated.status)).toBe(true);

      const deleted = await makeRestApiRequest({
        method: 'delete',
        path: `/companies/${companyId}`,
        bearer,
      });

      expect(isRefused(deleted.status)).toBe(true);
    }

    const stillOwned = await makeRestApiRequest({
      method: 'get',
      path: `/companies/${companyId}`,
    });

    expect(stillOwned.status).toBe(200);
    expect(stillOwned.body.data.company.name).toBe(COMPANY_NAME);
    expect(stillOwned.body.data.company.deletedAt).toBeNull();
  });

  it("GraphQL: YCombinator's credentials cannot query, update, delete or destroy Apple's company by id", async () => {
    const own = await makeGraphqlApiRequest({
      query: gql`
        query FindIsolationCompany($id: UUID!) {
          company(filter: { id: { eq: $id } }) {
            id
            name
          }
        }
      `,
      variables: { id: companyId },
    });

    expect(own.body.errors).toBeUndefined();
    expect(own.body.data.company?.name).toBe(COMPANY_NAME);

    for (const token of [ycAccessToken, ycApiKeyToken]) {
      const foreignRead = await makeGraphqlApiRequest(
        {
          query: gql`
            query FindIsolationCompany($id: UUID!) {
              company(filter: { id: { eq: $id } }) {
                id
                name
              }
            }
          `,
          variables: { id: companyId },
        },
        token,
      );

      expect(foreignRead.body.data?.company ?? null).toBeNull();
      expectNoLeak(foreignRead.body, {
        id: companyId,
        name: COMPANY_NAME,
        marker: MARKER,
      });

      for (const [operation, mutation] of [
        [
          'updateCompany',
          gql`
            mutation ($id: UUID!) {
              updateCompany(id: $id, data: { name: "tampered" }) {
                id
              }
            }
          `,
        ],
        [
          'deleteCompany',
          gql`
            mutation ($id: UUID!) {
              deleteCompany(id: $id) {
                id
              }
            }
          `,
        ],
        [
          'destroyCompany',
          gql`
            mutation ($id: UUID!) {
              destroyCompany(id: $id) {
                id
              }
            }
          `,
        ],
      ] as const) {
        const result = await makeGraphqlApiRequest(
          { query: mutation, variables: { id: companyId } },
          token,
        );

        expect(result.body.errors).toBeDefined();
      }
    }

    const stillOwned = await makeGraphqlApiRequest({
      query: gql`
        query FindIsolationCompany($id: UUID!) {
          company(filter: { id: { eq: $id } }) {
            id
            name
            deletedAt
          }
        }
      `,
      variables: { id: companyId },
    });

    expect(stillOwned.body.data.company.name).toBe(COMPANY_NAME);
    expect(stillOwned.body.data.company.deletedAt).toBeNull();
  });

  it("GraphQL: YCombinator's credentials find none of Apple's records when filtering by the shared marker", async () => {
    for (const token of [ycAccessToken, ycApiKeyToken]) {
      const result = await makeGraphqlApiRequest(
        {
          query: gql`
            query FindByMarker($name: String!) {
              companies(filter: { name: { ilike: $name } }) {
                edges {
                  node {
                    id
                  }
                }
              }
            }
          `,
          variables: { name: `%${MARKER}%` },
        },
        token,
      );

      expect(result.body.errors).toBeUndefined();
      expect(result.body.data.companies.edges).toEqual([]);
    }
  });

  it("GraphQL: YCombinator's credentials cannot read, update or delete Apple's note, which stays intact", async () => {
    const own = await makeGraphqlApiRequest({
      query: gql`
        query FindIsolationNote($id: UUID!) {
          note(filter: { id: { eq: $id } }) {
            id
            title
          }
        }
      `,
      variables: { id: noteId },
    });

    expect(own.body.errors).toBeUndefined();
    expect(own.body.data.note?.title).toBe(NOTE_TITLE);

    for (const token of [ycAccessToken, ycApiKeyToken]) {
      const foreignRead = await makeGraphqlApiRequest(
        {
          query: gql`
            query FindIsolationNote($id: UUID!) {
              note(filter: { id: { eq: $id } }) {
                id
                title
              }
            }
          `,
          variables: { id: noteId },
        },
        token,
      );

      expect(foreignRead.body.data?.note ?? null).toBeNull();
      expectNoLeak(foreignRead.body, {
        id: noteId,
        name: NOTE_TITLE,
        marker: MARKER,
      });

      const updated = await makeGraphqlApiRequest(
        {
          query: gql`
            mutation ($id: UUID!) {
              updateNote(id: $id, data: { title: "tampered" }) {
                id
              }
            }
          `,
          variables: { id: noteId },
        },
        token,
      );

      expect(updated.body.errors).toBeDefined();

      const destroyed = await makeGraphqlApiRequest(
        {
          query: gql`
            mutation ($id: UUID!) {
              destroyNote(id: $id) {
                id
              }
            }
          `,
          variables: { id: noteId },
        },
        token,
      );

      expect(destroyed.body.errors).toBeDefined();
    }

    const stillOwned = await makeGraphqlApiRequest({
      query: gql`
        query FindIsolationNote($id: UUID!) {
          note(filter: { id: { eq: $id } }) {
            id
            title
            deletedAt
          }
        }
      `,
      variables: { id: noteId },
    });

    expect(stillOwned.body.data.note.title).toBe(NOTE_TITLE);
    expect(stillOwned.body.data.note.deletedAt).toBeNull();
  });
});
