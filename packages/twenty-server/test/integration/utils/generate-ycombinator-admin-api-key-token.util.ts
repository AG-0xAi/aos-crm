import { getAppProviderByClassName } from 'test/integration/utils/get-app-provider-by-class-name.util';

import { type ApiKeyService } from 'src/engine/core-modules/api-key/services/api-key.service';
import { SEED_YCOMBINATOR_WORKSPACE_ID } from 'src/engine/workspace-manager/dev-seeder/core/constants/seeder-workspaces.constant';
import { API_KEY_DATA_SEED_IDS } from 'src/engine/workspace-manager/dev-seeder/data/constants/api-key-data-seeds.constant';

// The dev seeder gives every seeded workspace, including YCombinator, its
// own copy of this API key id with the admin role attached
// (dev-seeder-permissions.service.ts: the role-target for
// API_KEY_DATA_SEED_IDS.ID_1 is created for whichever workspaceId it is
// seeding). This mints the YCombinator twin of test-tokens.json's
// API_KEY_ACCESS_TOKEN (Apple's), through the real ApiKeyService and not a
// forged JWT.
export const generateYCombinatorAdminApiKeyToken = async (): Promise<string> => {
  const credentials = await getAppProviderByClassName<ApiKeyService>(
    'ApiKeyService',
  ).generateApiKeyToken(SEED_YCOMBINATOR_WORKSPACE_ID, API_KEY_DATA_SEED_IDS.ID_1);

  if (!credentials) {
    throw new Error('Could not mint the YCombinator admin API key token');
  }

  return credentials.token;
};
