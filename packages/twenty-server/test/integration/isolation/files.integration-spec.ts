import { randomUUID } from 'node:crypto';

import gql from 'graphql-tag';
import { createClient } from 'graphql-sse';
import request from 'supertest';
import { makeGraphqlApiRequest } from 'test/integration/graphql/utils/make-graphql-api-request.util';
import { uploadFileWithDirectUpload } from 'test/integration/graphql/utils/upload-file-with-direct-upload.util';
import { makeMetadataApiRequest } from 'test/integration/metadata/suites/utils/make-metadata-api-request.util';
import { updateFeatureFlag } from 'test/integration/metadata/suites/utils/update-feature-flag.util';
import { expectNoLeak } from 'test/integration/isolation/utils/expect-no-leak.util';
import { generateYCombinatorAdminAccessToken } from 'test/integration/utils/generate-ycombinator-admin-access-token.util';
import {
  generateYCombinatorAdminApiKeyToken,
  revokeYCombinatorAdminApiKeys,
} from 'test/integration/utils/generate-ycombinator-admin-api-key-token.util';
import { getAppProviderByClassName } from 'test/integration/utils/get-app-provider-by-class-name.util';
import { FeatureFlagKey } from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';

import { type FeatureFlagService } from 'src/engine/core-modules/feature-flag/services/feature-flag.service';
import { SEED_APPLE_WORKSPACE_ID } from 'src/engine/workspace-manager/dev-seeder/core/constants/seeder-workspaces.constant';

// CRM-038: files (attachments and record exports) are addressed by a
// signed, workspace-bound token rather than by a bearer credential alone
// (file-by-id.guard.ts, file-upload-token.guard.ts). This proves that
// YCombinator cannot reach Apple's attachment or record export by id or by
// signed path, and cannot upload into Apple's file id, while Apple's own
// signed URL and credentials keep working on the same resources.
const MARKER = `iso-${randomUUID()}`;

const isRefused = (status: number) => status >= 400 && status < 500;

// Uploading into FileFolder.FilesField requires a real fieldMetadataId
// pointing at a Files-type field (file-upload.service.ts's
// resolveUploadLocation); the attachment's own "file" field is that field.
const findAttachmentFileFieldMetadataId = async (
  token?: string,
): Promise<string> => {
  const objects = await makeMetadataApiRequest(
    {
      query: gql`
        query {
          objects(paging: { first: 200 }) {
            edges {
              node {
                nameSingular
                fieldsList {
                  id
                  name
                }
              }
            }
          }
        }
      `,
    },
    token,
  );

  const attachmentObject = objects.body.data.objects.edges.find(
    (edge: { node: { nameSingular: string } }) =>
      edge.node.nameSingular === 'attachment',
  ).node;

  return attachmentObject.fieldsList.find(
    (field: { name: string }) => field.name === 'file',
  ).id;
};

describe('cross-workspace isolation: files', () => {
  let ycAccessToken: string;
  let ycApiKeyToken: string;
  let noteId: string;
  let attachmentId: string;
  let fileId: string;
  let fileFolder: string;
  let fileUrlPath: string;
  let attachmentFileFieldMetadataId: string;
  let ycAttachmentFileFieldMetadataId: string;

  beforeAll(async () => {
    [ycAccessToken, ycApiKeyToken] = await Promise.all([
      generateYCombinatorAdminAccessToken(),
      generateYCombinatorAdminApiKeyToken(),
    ]);

    [attachmentFileFieldMetadataId, ycAttachmentFileFieldMetadataId] =
      await Promise.all([
        findAttachmentFileFieldMetadataId(),
        findAttachmentFileFieldMetadataId(ycAccessToken),
      ]);

    const createdNote = await makeGraphqlApiRequest({
      query: gql`
        mutation CreateIsolationNote($title: String!) {
          createNote(data: { title: $title }) {
            id
          }
        }
      `,
      variables: { title: `Isolation Note ${MARKER}` },
    });

    expect(createdNote.body.errors).toBeUndefined();
    noteId = createdNote.body.data.createNote.id;

    const uploadedFile = await uploadFileWithDirectUpload({
      filename: `isolation-${MARKER}.txt`,
      content: Buffer.from(`attachment content ${MARKER}`),
      fileFolder: 'FilesField',
      fieldMetadataId: attachmentFileFieldMetadataId,
    });
    fileId = uploadedFile.id;

    const createdAttachment = await makeGraphqlApiRequest({
      query: gql`
        mutation CreateIsolationAttachment($fileId: UUID!, $noteId: UUID!) {
          createAttachment(
            data: {
              file: [{ fileId: $fileId, label: "isolation-attachment" }]
              targetNoteId: $noteId
            }
          ) {
            id
            file {
              fileId
              url
            }
          }
        }
      `,
      variables: { fileId, noteId },
    });

    expect(createdAttachment.body.errors).toBeUndefined();
    attachmentId = createdAttachment.body.data.createAttachment.id;

    const signedUrl = createdAttachment.body.data.createAttachment.file[0].url;
    const parsed = new URL(signedUrl);

    fileUrlPath = `${parsed.pathname}${parsed.search}`;
    fileFolder = parsed.pathname.split('/')[2];
  });

  afterAll(async () => {
    await revokeYCombinatorAdminApiKeys();

    await makeGraphqlApiRequest({
      query: gql`
        mutation DestroyIsolationFiles($attachmentId: UUID!, $noteId: UUID!) {
          destroyAttachment(id: $attachmentId) {
            id
          }
          destroyNote(id: $noteId) {
            id
          }
        }
      `,
      variables: { attachmentId, noteId },
    });
  });

  it("downloads with Apple's own signed URL, and is refused for every credential on the unsigned path", async () => {
    const own = await request(global.app.getHttpServer()).get(fileUrlPath);

    expect(own.status).toBe(200);
    expect(own.text).toContain(MARKER);

    const unsignedPath = `/file/${fileFolder}/${fileId}`;

    for (const [, headers] of [
      ['no credential', {}],
      [
        'YCombinator access token',
        { Authorization: `Bearer ${ycAccessToken}` },
      ],
      ['YCombinator API key', { Authorization: `Bearer ${ycApiKeyToken}` }],
    ] as const) {
      const response = await request(global.app.getHttpServer())
        .get(unsignedPath)
        .set(headers);

      expect(isRefused(response.status)).toBe(true);
    }
  });

  it("YCombinator's real upload attempt into Apple's folder, through the upload controller, is refused and Apple's file is unchanged", async () => {
    const ycUpload = await uploadFileWithDirectUpload({
      filename: `yc-isolation-${MARKER}.txt`,
      content: Buffer.from('ycombinator content'),
      fileFolder: 'FilesField',
      fieldMetadataId: ycAttachmentFileFieldMetadataId,
      token: ycAccessToken,
    });

    expect(ycUpload.id).not.toBe(fileId);

    const createdForYc = await makeMetadataApiRequest(
      {
        query: gql`
          mutation CreateIsolationFileUpload(
            $filename: String!
            $size: Float!
            $fileFolder: FileFolder!
            $fieldMetadataId: String!
          ) {
            createFileUpload(
              filename: $filename
              size: $size
              fileFolder: $fileFolder
              fieldMetadataId: $fieldMetadataId
            ) {
              fileId
              uploadUrl
              contentType
            }
          }
        `,
        variables: {
          filename: `yc-hijack-${MARKER}.txt`,
          size: 7,
          fileFolder: 'FilesField',
          fieldMetadataId: ycAttachmentFileFieldMetadataId,
        },
      },
      ycAccessToken,
    );

    expect(createdForYc.body.errors).toBeUndefined();
    const ycUploadTarget = createdForYc.body.data.createFileUpload;
    const ycUploadUrl = new URL(ycUploadTarget.uploadUrl);

    // Apple's own fileId substituted into YCombinator's upload path, keeping
    // YCombinator's signed token: the guard binds fileId from the token
    // payload, so this must be refused rather than silently targeting
    // Apple's file.
    const hijackPath = ycUploadUrl.pathname.replace(
      ycUploadTarget.fileId,
      fileId,
    );
    const hijackAttempt = await request(global.app.getHttpServer())
      .put(`${hijackPath}${ycUploadUrl.search}`)
      .set('Content-Type', 'text/plain')
      .send(Buffer.from('hijacked'));

    expect(isRefused(hijackAttempt.status)).toBe(true);

    // completeFileUpload addressing Apple's existing file id with
    // YCombinator's credential: workspace-scoped lookup, must fail.
    const completeAttempt = await makeMetadataApiRequest(
      {
        query: gql`
          mutation CompleteIsolationFileUpload($fileId: String!) {
            completeFileUpload(fileId: $fileId) {
              id
            }
          }
        `,
        variables: { fileId },
      },
      ycAccessToken,
    );

    expect(completeAttempt.body.errors).toBeDefined();

    const stillOwn = await request(global.app.getHttpServer()).get(fileUrlPath);

    expect(stillOwn.status).toBe(200);
    expect(stillOwn.text).toContain(MARKER);
  });

  it("YCombinator's credentials cannot read Apple's attachment record, and Apple's own token can", async () => {
    const own = await makeGraphqlApiRequest({
      query: gql`
        query FindIsolationAttachment($id: UUID!) {
          attachment(filter: { id: { eq: $id } }) {
            id
          }
        }
      `,
      variables: { id: attachmentId },
    });

    expect(own.body.data.attachment?.id).toBe(attachmentId);

    for (const token of [ycAccessToken, ycApiKeyToken]) {
      const foreign = await makeGraphqlApiRequest(
        {
          query: gql`
            query FindIsolationAttachment($id: UUID!) {
              attachment(filter: { id: { eq: $id } }) {
                id
              }
            }
          `,
          variables: { id: attachmentId },
        },
        token,
      );

      expect(foreign.body.data?.attachment ?? null).toBeNull();
      expectNoLeak(foreign.body, {
        id: attachmentId,
        name: 'isolation-attachment',
        marker: MARKER,
      });
    }
  });

  describe('record export', () => {
    let companyId: string;
    let exportFieldIds: string[];
    let companyObjectMetadataId: string;
    let wasAsyncCsvExportEnabled: boolean;

    beforeAll(async () => {
      const featureFlagService =
        getAppProviderByClassName<FeatureFlagService>('FeatureFlagService');

      wasAsyncCsvExportEnabled = await featureFlagService.isFeatureEnabled(
        FeatureFlagKey.IS_ASYNC_CSV_EXPORT_ENABLED,
        SEED_APPLE_WORKSPACE_ID,
      );
      await updateFeatureFlag({
        featureFlag: FeatureFlagKey.IS_ASYNC_CSV_EXPORT_ENABLED,
        value: true,
        expectToFail: false,
      });

      const created = await makeGraphqlApiRequest({
        query: gql`
          mutation CreateIsolationExportCompany($name: String!) {
            createCompany(data: { name: $name }) {
              id
            }
          }
        `,
        variables: { name: `Isolation Export Co ${MARKER}` },
      });

      expect(created.body.errors).toBeUndefined();
      companyId = created.body.data.createCompany.id;

      const objects = await makeMetadataApiRequest({
        query: gql`
          query {
            objects(paging: { first: 200 }) {
              edges {
                node {
                  id
                  nameSingular
                  fieldsList {
                    id
                    name
                  }
                }
              }
            }
          }
        `,
      });

      const companyObject = objects.body.data.objects.edges.find(
        (edge: { node: { nameSingular: string } }) =>
          edge.node.nameSingular === 'company',
      ).node;

      companyObjectMetadataId = companyObject.id;
      exportFieldIds = companyObject.fieldsList
        .filter((field: { name: string }) =>
          ['id', 'name'].includes(field.name),
        )
        .map((field: { id: string }) => field.id);
    });

    afterAll(async () => {
      await makeGraphqlApiRequest({
        query: gql`
          mutation DestroyIsolationExportCompany($id: UUID!) {
            destroyCompany(id: $id) {
              id
            }
          }
        `,
        variables: { id: companyId },
      });

      await updateFeatureFlag({
        featureFlag: FeatureFlagKey.IS_ASYNC_CSV_EXPORT_ENABLED,
        value: wasAsyncCsvExportEnabled,
        expectToFail: false,
      });
    });

    const authenticationHeaders = (token: string) => ({
      Authorization: `Bearer ${token}`,
    });

    it("Apple's export downloads with Apple's own credential, and is refused for YCombinator's credentials on the same signed path", async () => {
      const connection = createClient({
        url: `http://localhost:${APP_PORT}/metadata`,
        headers: authenticationHeaders(APPLE_JANE_ADMIN_ACCESS_TOKEN),
        retryAttempts: 0,
      });

      let downloadPath: string | undefined;

      try {
        const events = connection.iterate<{
          exportRecords: {
            id: string;
            downloadPath: string | null;
            errorMessage: string | null;
          };
        }>({
          query: `subscription ExportRecords($input: CreateRecordExportInput!) {
            exportRecords(input: $input) {
              id downloadPath errorMessage
            }
          }`,
          variables: {
            input: {
              objectMetadataId: companyObjectMetadataId,
              fieldMetadataIds: exportFieldIds,
              filter: { id: { in: [companyId] } },
            },
          },
        });

        for (let i = 0; i < 20 && !isDefined(downloadPath); i++) {
          const event = await events.next();

          if (event.done) {
            break;
          }
          if (isDefined(event.value.data?.exportRecords.errorMessage)) {
            throw new Error(event.value.data.exportRecords.errorMessage!);
          }
          downloadPath =
            event.value.data?.exportRecords.downloadPath ?? undefined;
        }
      } finally {
        connection.dispose();
      }

      expect(downloadPath).toBeDefined();

      const own = await request(global.app.getHttpServer())
        .get(downloadPath!)
        .set(authenticationHeaders(APPLE_JANE_ADMIN_ACCESS_TOKEN));

      expect(own.status).toBe(200);

      for (const token of [ycAccessToken, ycApiKeyToken]) {
        const foreign = await request(global.app.getHttpServer())
          .get(downloadPath!)
          .set(authenticationHeaders(token));

        expect(isRefused(foreign.status)).toBe(true);
      }

      const noCredential = await request(global.app.getHttpServer()).get(
        downloadPath!,
      );

      expect(isRefused(noCredential.status)).toBe(true);
    });
  });
});
