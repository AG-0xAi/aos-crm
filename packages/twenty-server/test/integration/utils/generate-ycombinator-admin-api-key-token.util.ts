import { findOneRoleByLabel } from 'test/integration/metadata/suites/role/utils/find-one-role-by-label.util';
import { generateYCombinatorAdminAccessToken } from 'test/integration/utils/generate-ycombinator-admin-access-token.util';
import { getAppProviderByClassName } from 'test/integration/utils/get-app-provider-by-class-name.util';

import { type ApiKeyService } from 'src/engine/core-modules/api-key/services/api-key.service';
import { SEED_YCOMBINATOR_WORKSPACE_ID } from 'src/engine/workspace-manager/dev-seeder/core/constants/seeder-workspaces.constant';

// API_KEY_DATA_SEED_IDS.ID_1, the id test-tokens.json's API_KEY_ACCESS_TOKEN
// carries, lives in the shared core.apiKey table keyed by that id alone:
// the dev seeder inserts it once for Apple with `.orIgnore()`, so
// YCombinator's seeding of the "same" id is silently dropped and there is
// no YCombinator twin of that row to mint a token for (measured: minting
// against it throws "API Key with id ... not found" for
// SEED_YCOMBINATOR_WORKSPACE_ID). This creates a REAL, separate API key
// scoped to YCombinator instead, with the admin role YCombinator's own
// seeding did attach per-workspace, through the real ApiKeyService.
const createdApiKeyIds: string[] = [];

export const revokeYCombinatorAdminApiKeys = async (): Promise<void> => {
  const apiKeyService =
    getAppProviderByClassName<ApiKeyService>('ApiKeyService');

  for (const apiKeyId of createdApiKeyIds.splice(0)) {
    await apiKeyService.revoke(apiKeyId, SEED_YCOMBINATOR_WORKSPACE_ID);
  }
};

export const generateYCombinatorAdminApiKeyToken =
  async (): Promise<string> => {
    const ycAccessToken = await generateYCombinatorAdminAccessToken();
    const adminRole = await findOneRoleByLabel({
      label: 'Admin',
      token: ycAccessToken,
    });

    const apiKeyService =
      getAppProviderByClassName<ApiKeyService>('ApiKeyService');

    const apiKey = await apiKeyService.create({
      workspaceId: SEED_YCOMBINATOR_WORKSPACE_ID,
      name: 'CRM-038 isolation YCombinator admin key',
      expiresAt: new Date(Date.now() + 3600_000),
      revokedAt: null,
      roleId: adminRole.id,
    });

    createdApiKeyIds.push(apiKey.id);

    const credentials = await apiKeyService.generateApiKeyToken(
      SEED_YCOMBINATOR_WORKSPACE_ID,
      apiKey.id,
      apiKey.expiresAt,
    );

    if (!credentials) {
      throw new Error('Could not mint the YCombinator admin API key token');
    }

    return credentials.token;
  };
