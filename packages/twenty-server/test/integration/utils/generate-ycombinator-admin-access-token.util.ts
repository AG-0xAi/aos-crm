import { getAppProviderByClassName } from 'test/integration/utils/get-app-provider-by-class-name.util';

import { type AccessTokenService } from 'src/engine/core-modules/auth/token/services/access-token.service';
import { AuthProviderEnum } from 'src/engine/core-modules/workspace/types/workspace.type';
import { SEED_YCOMBINATOR_WORKSPACE_ID } from 'src/engine/workspace-manager/dev-seeder/core/constants/seeder-workspaces.constant';
import { USER_DATA_SEED_IDS } from 'src/engine/workspace-manager/dev-seeder/core/utils/seed-users.util';

// The isolation suites need a real credential for a seeded member of the
// OTHER seeded workspace (YCombinator), the same way test-tokens.json's
// APPLE_JANE_ADMIN_ACCESS_TOKEN carries one for Apple's admin -- minted
// through the real AccessTokenService rather than hand-assembled, and
// through Tim, who is the seeded admin of YCombinator
// (dev-seeder-permissions.service.ts).
export const generateYCombinatorAdminAccessToken =
  async (): Promise<string> => {
    const { token } = await getAppProviderByClassName<AccessTokenService>(
      'AccessTokenService',
    ).generateAccessToken({
      userId: USER_DATA_SEED_IDS.TIM,
      workspaceId: SEED_YCOMBINATOR_WORKSPACE_ID,
      authProvider: AuthProviderEnum.Password,
    });

    return token;
  };
