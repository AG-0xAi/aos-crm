import { WorkspaceActivationStatus } from 'twenty-shared/workspace';

import { SignInUpService } from 'src/engine/core-modules/auth/services/sign-in-up.service';
import { type UserEntity } from 'src/engine/core-modules/user/user.entity';
import { type WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';

// Everything below is a stand-in for a dependency signUpOnNewWorkspace and
// signInUpOnExistingWorkspace walk through on their way to enqueuing the
// webhook event: resolved happy-path values only, nothing this spec asserts
// on. dataSource.transaction runs its callback against a queryRunner whose
// manager.save echoes back whatever it is given, mirroring a real INSERT
// that returns the row as-is.
const buildService = () => {
  const userRepository = {
    create: jest.fn((entity) => entity),
    save: jest.fn(async (entity) => ({ id: 'new-user-1', ...entity })),
    count: jest.fn(async () => 1),
  };

  const workspaceRepository = {
    create: jest.fn((entity) => entity),
    count: jest.fn(async () => 0),
  };

  const workspaceInvitationService = {};
  const userWorkspaceService = {
    create: jest.fn(async () => undefined),
    addUserToWorkspaceIfUserNotInWorkspace: jest.fn(async () => undefined),
  };
  const onboardingService = {
    setOnboardingConnectAccountPending: jest.fn(async () => undefined),
    setOnboardingCreateProfilePending: jest.fn(async () => undefined),
    setOnboardingInviteTeamPending: jest.fn(async () => undefined),
  };
  const workspaceEventEmitter = {
    emitCustomBatchEvent: jest.fn(),
  };
  const twentyConfigService = {
    get: jest.fn((key: string) => {
      if (key === 'IS_MULTIWORKSPACE_ENABLED') return false;
      if (key === 'IS_WORKSPACE_CREATION_LIMITED_TO_SERVER_ADMINS')
        return false;
      if (key === 'MAX_WORKSPACES') return 0;
      if (key === 'SERVER_URL' || key === 'SERVER_ID') return 'test';

      return undefined;
    }),
  };
  const subdomainManagerService = {
    validateSubdomainOrThrow: jest.fn(async () => undefined),
    generateSubdomain: jest.fn(async () => 'generated'),
  };
  const userService = {};
  const metricsService = {
    incrementCounterForEvent: jest.fn(async () => undefined),
  };
  const workspaceCacheService = {
    invalidateAndRecompute: jest.fn(async () => undefined),
  };
  const applicationService = {
    createWorkspaceCustomApplication: jest.fn(async () => ({
      universalIdentifier: 'app-universal-id',
    })),
  };
  const fileStorageService = {
    invalidateStorageStock: jest.fn(async () => undefined),
  };
  const exceptionHandlerService = {};
  const enterprisePlanService = {
    isValid: jest.fn(() => false),
  };
  const eventLogEmitterService = {
    createContext: jest.fn(() => ({
      insertWorkspaceEvent: jest.fn(async () => undefined),
    })),
  };
  const billingService = {
    isBillingEnabled: jest.fn(() => false),
  };
  const signUpInvitationService = {
    findLiveInvitationForEmail: jest.fn(async () => undefined),
  };
  const signupWebhookService = {
    enqueue: jest.fn(async () => undefined),
  };
  const dataSource = {
    transaction: jest.fn(async (work: (entityManager: unknown) => unknown) => {
      const queryRunner = {
        manager: {
          save: jest.fn(async (_entity: unknown, value: unknown) => value),
        },
      };

      return work({ queryRunner });
    }),
  };

  const service = new SignInUpService(
    userRepository as never,
    workspaceRepository as never,
    workspaceInvitationService as never,
    userWorkspaceService as never,
    onboardingService as never,
    workspaceEventEmitter as never,
    twentyConfigService as never,
    subdomainManagerService as never,
    userService as never,
    metricsService as never,
    workspaceCacheService as never,
    applicationService as never,
    fileStorageService as never,
    exceptionHandlerService as never,
    enterprisePlanService as never,
    eventLogEmitterService as never,
    billingService as never,
    signUpInvitationService as never,
    signupWebhookService as never,
    dataSource as never,
  );

  return { service, signupWebhookService, userRepository };
};

describe('SignInUpService', () => {
  describe('signUpOnNewWorkspace', () => {
    it('enqueues user.signed_up with via "other" when there is no sign-up invitation', async () => {
      const { service, signupWebhookService } = buildService();

      const existingUser = {
        id: 'user-1',
        email: 'ana@example.test',
        firstName: 'Ana',
        lastName: 'Lopez',
        locale: 'en',
      } as UserEntity;

      await service.signUpOnNewWorkspace(
        { type: 'existingUser', existingUser },
        { displayName: 'Ana Co', subdomain: 'ana-co' },
      );

      expect(signupWebhookService.enqueue).toHaveBeenCalledWith({
        event: 'user.signed_up',
        email: 'ana@example.test',
        firstName: 'Ana',
        lastName: 'Lopez',
        locale: 'en',
        workspace: { subdomain: 'ana-co', displayName: 'Ana Co' },
        via: 'other',
      });
    });

    it('never fails workspace creation when the webhook enqueue rejects', async () => {
      const { service, signupWebhookService } = buildService();

      (signupWebhookService.enqueue as jest.Mock).mockRejectedValue(
        new Error('queue down'),
      );

      const existingUser = {
        id: 'user-1',
        email: 'ana@example.test',
        firstName: 'Ana',
        lastName: 'Lopez',
        locale: 'en',
      } as UserEntity;

      await expect(
        service.signUpOnNewWorkspace(
          { type: 'existingUser', existingUser },
          { displayName: 'Ana Co', subdomain: 'ana-co' },
        ),
      ).resolves.toMatchObject({ user: existingUser });
    });
  });

  describe('signInUpOnExistingWorkspace', () => {
    it('enqueues user.signed_up with via "workspace_invitation" for a brand-new member', async () => {
      const { service, signupWebhookService } = buildService();

      const workspace = {
        id: 'workspace-1',
        subdomain: 'acme',
        displayName: 'Acme',
        activationStatus: WorkspaceActivationStatus.ACTIVE,
      } as WorkspaceEntity;

      const user = await service.signInUpOnExistingWorkspace({
        workspace,
        userData: {
          type: 'newUserWithPicture',
          newUserWithPicture: {
            email: 'bob@example.test',
            firstName: 'Bob',
            lastName: 'Smith',
            locale: 'es-ES',
          },
        },
      });

      expect(signupWebhookService.enqueue).toHaveBeenCalledWith({
        event: 'user.signed_up',
        email: 'bob@example.test',
        firstName: 'Bob',
        lastName: 'Smith',
        locale: 'es-ES',
        workspace: { subdomain: 'acme', displayName: 'Acme' },
        via: 'workspace_invitation',
      });
      expect(user.email).toBe('bob@example.test');
    });
  });
});
