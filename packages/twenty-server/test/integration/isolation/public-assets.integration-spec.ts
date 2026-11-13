import { randomUUID } from 'node:crypto';

import request from 'supertest';
import { getAppProviderByClassName } from 'test/integration/utils/get-app-provider-by-class-name.util';
import { ApiPath, FileFolder } from 'twenty-shared/types';

import { type FileStorageService } from 'src/engine/core-modules/file-storage/services/file-storage.service';
import {
  SEED_APPLE_WORKSPACE_ID,
  SEED_YCOMBINATOR_WORKSPACE_ID,
} from 'src/engine/workspace-manager/dev-seeder/core/constants/seeder-workspaces.constant';
import { TWENTY_STANDARD_APPLICATION } from 'src/engine/workspace-manager/twenty-standard-application/constants/twenty-standard-applications';

// CRM-038: the public-assets route needs no credential by design, so the
// only boundary is the workspaceId in the path: an asset stored for Apple
// must be served under Apple's workspace id and refused when the same
// application id and path are addressed under YCombinator's.
const MARKER = `iso-${randomUUID()}`;
const RESOURCE_PATH = `isolation-${MARKER}.txt`;

describe('cross-workspace isolation: public assets', () => {
  let fileStorageService: FileStorageService;
  let applicationId: string;

  beforeAll(async () => {
    fileStorageService =
      getAppProviderByClassName<FileStorageService>('FileStorageService');

    const file = await fileStorageService.writeFile({
      sourceFile: Buffer.from(`public asset ${MARKER}`),
      fileFolder: FileFolder.PublicAsset,
      applicationUniversalIdentifier:
        TWENTY_STANDARD_APPLICATION.universalIdentifier,
      workspaceId: SEED_APPLE_WORKSPACE_ID,
      resourcePath: RESOURCE_PATH,
      settings: { isTemporaryFile: false, toDelete: false },
    });

    applicationId = file.applicationId;
  });

  afterAll(async () => {
    await fileStorageService.deleteFile({
      fileFolder: FileFolder.PublicAsset,
      applicationUniversalIdentifier:
        TWENTY_STANDARD_APPLICATION.universalIdentifier,
      workspaceId: SEED_APPLE_WORKSPACE_ID,
      resourcePath: RESOURCE_PATH,
    });
  });

  it("serves Apple's asset under Apple's workspace id and refuses it under YCombinator's", async () => {
    const own = await request(global.app.getHttpServer()).get(
      `/${ApiPath.PublicAssets}/${SEED_APPLE_WORKSPACE_ID}/${applicationId}/${RESOURCE_PATH}`,
    );

    expect(own.status).toBe(200);
    expect(own.text).toContain(MARKER);

    const foreign = await request(global.app.getHttpServer()).get(
      `/${ApiPath.PublicAssets}/${SEED_YCOMBINATOR_WORKSPACE_ID}/${applicationId}/${RESOURCE_PATH}`,
    );

    expect(foreign.status).toBeGreaterThanOrEqual(400);
    expect(foreign.status).toBeLessThan(500);
    expect(JSON.stringify(foreign.body ?? null)).not.toContain(MARKER);
    expect(foreign.text ?? '').not.toContain(MARKER);
  });
});
