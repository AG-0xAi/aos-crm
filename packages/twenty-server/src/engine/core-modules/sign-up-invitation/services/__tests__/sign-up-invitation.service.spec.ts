import { type Repository } from 'typeorm';

import {
  type AppTokenEntity,
  AppTokenType,
} from 'src/engine/core-modules/app-token/app-token.entity';
import { AuthExceptionCode } from 'src/engine/core-modules/auth/auth.exception';
import { type WorkspaceDomainsService } from 'src/engine/core-modules/domain/workspace-domains/services/workspace-domains.service';
import { type EmailService } from 'src/engine/core-modules/email/email.service';
import { type I18nService } from 'src/engine/core-modules/i18n/i18n.service';
import { SignUpInvitationStatusEnum } from 'src/engine/core-modules/sign-up-invitation/enums/sign-up-invitation-status.enum';
import {
  hashSignUpInvitationToken,
  SIGN_UP_INVITATION_TOKEN_SEARCH_PARAM,
  SignUpInvitationService,
} from 'src/engine/core-modules/sign-up-invitation/services/sign-up-invitation.service';
import { type TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';

jest.mock('twenty-emails', () => ({
  SignUpInviteLinkEmail: jest.fn(() => ({ template: true })),
  renderEmail: jest.fn(async () => 'rendered'),
}));

const PLAIN_TOKEN = 'a'.repeat(64);
const EMAIL = 'ana@example.test';

const liveInvitation = (overrides: Partial<AppTokenEntity> = {}) =>
  ({
    id: '11111111-1111-4111-8111-111111111111',
    type: AppTokenType.SignUpInvitationToken,
    value: hashSignUpInvitationToken(PLAIN_TOKEN),
    expiresAt: new Date(Date.now() + 86_400_000),
    createdAt: new Date(),
    revokedAt: null,
    deletedAt: null,
    context: { email: EMAIL },
    ...overrides,
  }) as AppTokenEntity;

type Fakes = {
  service: SignUpInvitationService;
  appTokenRepository: jest.Mocked<Repository<AppTokenEntity>>;
  emailService: jest.Mocked<EmailService>;
  update: jest.Mock;
};

const buildService = (): Fakes => {
  const appTokenRepository = {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn((entity) => entity),
    save: jest.fn(async (entity) => ({
      ...entity,
      id: entity.id ?? liveInvitation().id,
      createdAt: new Date(),
    })),
    update: jest.fn(),
  } as unknown as jest.Mocked<Repository<AppTokenEntity>>;

  const emailService = { send: jest.fn() } as unknown as jest.Mocked<EmailService>;

  const twentyConfigService = {
    get: jest.fn((key: string) =>
      key === 'SIGN_UP_INVITATION_TOKEN_EXPIRES_IN' ? '7d' : 'Betty',
    ),
  } as unknown as TwentyConfigService;

  const workspaceDomainsService = {
    getSubdomainAndCustomDomainFromWorkspaceFallbackOnDefaultSubdomain:
      jest.fn(() => ({
        subdomain: 'app',
        customDomain: null,
        isCustomDomainEnabled: false,
      })),
    buildWorkspaceURL: jest.fn(
      ({ pathname, searchParams }) =>
        new URL(
          `http://app.localhost${pathname}?${new URLSearchParams(searchParams as Record<string, string>).toString()}`,
        ),
    ),
  } as unknown as WorkspaceDomainsService;

  const i18nService = {
    getI18nInstance: jest.fn(() => ({ _: (message: unknown) => String(message) })),
  } as unknown as I18nService;

  const service = new SignUpInvitationService(
    appTokenRepository,
    twentyConfigService,
    workspaceDomainsService,
    emailService,
    i18nService,
  );

  return {
    service,
    appTokenRepository,
    emailService,
    update: appTokenRepository.update as unknown as jest.Mock,
  };
};

describe('SignUpInvitationService', () => {
  describe('findLiveInvitationForEmail', () => {
    it.each([
      ['no token', { plainToken: undefined, email: EMAIL }],
      ['an empty token', { plainToken: '', email: EMAIL }],
      ['no address', { plainToken: PLAIN_TOKEN, email: undefined }],
    ])('refuses %s without touching the database', async (_label, params) => {
      const { service, appTokenRepository } = buildService();

      await expect(
        service.findLiveInvitationForEmail(params),
      ).resolves.toBeUndefined();
      expect(appTokenRepository.findOne).not.toHaveBeenCalled();
    });

    it('looks the token up by its hash and never by its plaintext', async () => {
      const { service, appTokenRepository } = buildService();

      appTokenRepository.findOne.mockResolvedValue(liveInvitation());

      await service.findLiveInvitationForEmail({
        plainToken: PLAIN_TOKEN,
        email: EMAIL,
      });

      const where = appTokenRepository.findOne.mock.calls[0][0]
        .where as Record<string, unknown>;

      expect(where.value).toBe(hashSignUpInvitationToken(PLAIN_TOKEN));
      expect(where.value).not.toBe(PLAIN_TOKEN);
      expect(where.type).toBe(AppTokenType.SignUpInvitationToken);
    });

    it('refuses an invitation addressed to another mailbox', async () => {
      const { service, appTokenRepository } = buildService();

      appTokenRepository.findOne.mockResolvedValue(liveInvitation());

      await expect(
        service.findLiveInvitationForEmail({
          plainToken: PLAIN_TOKEN,
          email: 'someone.else@example.test',
        }),
      ).resolves.toBeUndefined();
    });

    it('accepts the invited mailbox whatever its case', async () => {
      const { service, appTokenRepository } = buildService();

      appTokenRepository.findOne.mockResolvedValue(liveInvitation());

      await expect(
        service.findLiveInvitationForEmail({
          plainToken: PLAIN_TOKEN,
          email: ' Ana@Example.Test ',
        }),
      ).resolves.toBeDefined();
    });
  });

  describe('consumeWithinTransaction', () => {
    const entityManagerWithAffected = (affected: number | null | undefined) => {
      const execute = jest.fn(async () => ({ affected }));
      const builder = {
        update: jest.fn(() => builder),
        set: jest.fn(() => builder),
        where: jest.fn(() => builder),
        andWhere: jest.fn(() => builder),
        setParameter: jest.fn(() => builder),
        execute,
      };

      return {
        entityManager: {
          createQueryBuilder: jest.fn(() => builder),
        },
        builder,
      };
    };

    it('consumes the invitation exactly once', async () => {
      const { service } = buildService();
      const { entityManager, builder } = entityManagerWithAffected(1);

      await service.consumeWithinTransaction({
        entityManager: entityManager as never,
        invitationId: liveInvitation().id,
        consumedByUserId: 'user-1',
      });

      expect(builder.andWhere).toHaveBeenCalledWith('"revokedAt" IS NULL');
    });

    it.each([[0], [null], [undefined], [2]])(
      'throws when the conditional update affected %s rows',
      async (affected) => {
        const { service } = buildService();
        const { entityManager } = entityManagerWithAffected(affected);

        await expect(
          service.consumeWithinTransaction({
            entityManager: entityManager as never,
            invitationId: liveInvitation().id,
            consumedByUserId: 'user-1',
          }),
        ).rejects.toMatchObject({
          code: AuthExceptionCode.FORBIDDEN_EXCEPTION,
        });
      },
    );
  });

  describe('create', () => {
    it('refuses a second live invitation for the same address', async () => {
      const { service, appTokenRepository, emailService } = buildService();

      appTokenRepository.findOne.mockResolvedValue(liveInvitation());

      await expect(
        service.create({ email: EMAIL, issuedByUserId: 'operator' }),
      ).rejects.toMatchObject({ code: AuthExceptionCode.INVALID_INPUT });
      expect(emailService.send).not.toHaveBeenCalled();
    });

    it('stores only the hash and mails a link carrying the plaintext', async () => {
      const { service, appTokenRepository, emailService } = buildService();

      appTokenRepository.findOne.mockResolvedValue(null);

      const created = await service.create({
        email: ' Ana@Example.Test ',
        issuedByUserId: 'operator',
      });

      expect(created.email).toBe(EMAIL);
      expect(created.status).toBe(SignUpInvitationStatusEnum.Pending);

      const saved = appTokenRepository.save.mock
        .calls[0][0] as unknown as AppTokenEntity;

      expect(saved.value).toHaveLength(64);
      expect(saved.context?.email).toBe(EMAIL);
      expect(saved.context?.issuedByUserId).toBe('operator');

      const { html } = emailService.send.mock.calls[0][0] as { html: string };

      expect(html).toBe('rendered');

      const link = (
        jest.requireMock('twenty-emails') as {
          SignUpInviteLinkEmail: jest.Mock;
        }
      ).SignUpInviteLinkEmail.mock.calls.at(-1)?.[0].link as string;
      const linkToken = new URL(link).searchParams.get(
        SIGN_UP_INVITATION_TOKEN_SEARCH_PARAM,
      );

      expect(linkToken).toHaveLength(64);
      expect(hashSignUpInvitationToken(linkToken as string)).toBe(saved.value);
    });
  });

  describe('resend and revoke', () => {
    it('refuses to resend a redeemed invitation', async () => {
      const { service, appTokenRepository, emailService } = buildService();

      appTokenRepository.findOne.mockResolvedValue(
        liveInvitation({
          revokedAt: new Date(),
          context: { email: EMAIL, consumedAt: new Date().toISOString() },
        }),
      );

      await expect(service.resend({ id: liveInvitation().id })).rejects.toMatchObject(
        { code: AuthExceptionCode.INVALID_INPUT },
      );
      expect(emailService.send).not.toHaveBeenCalled();
    });

    it('refuses to resend a revoked invitation', async () => {
      const { service, appTokenRepository, emailService } = buildService();

      appTokenRepository.findOne.mockResolvedValue(
        liveInvitation({ revokedAt: new Date() }),
      );

      await expect(service.resend({ id: liveInvitation().id })).rejects.toMatchObject(
        { code: AuthExceptionCode.INVALID_INPUT },
      );
      expect(emailService.send).not.toHaveBeenCalled();
    });

    it('rotates the token in place when it resends an expired invitation', async () => {
      const { service, appTokenRepository, emailService } = buildService();
      const expired = liveInvitation({
        expiresAt: new Date(Date.now() - 1000),
      });

      appTokenRepository.findOne.mockResolvedValue(expired);

      await service.resend({ id: expired.id });

      const saved = appTokenRepository.save.mock
        .calls[0][0] as unknown as AppTokenEntity;

      expect(saved.id).toBe(expired.id);
      expect(saved.value).not.toBe(expired.value);
      expect(saved.revokedAt).toBeNull();
      expect(emailService.send).toHaveBeenCalledTimes(1);
    });

    it('refuses to revoke a redeemed invitation', async () => {
      const { service, appTokenRepository, update } = buildService();

      appTokenRepository.findOne.mockResolvedValue(
        liveInvitation({
          revokedAt: new Date(),
          context: { email: EMAIL, consumedAt: new Date().toISOString() },
        }),
      );

      await expect(service.revoke(liveInvitation().id)).rejects.toMatchObject({
        code: AuthExceptionCode.INVALID_INPUT,
      });
      expect(update).not.toHaveBeenCalled();
    });

    it('revokes a pending invitation', async () => {
      const { service, appTokenRepository, update } = buildService();
      const pending = liveInvitation();

      appTokenRepository.findOne
        .mockResolvedValueOnce(pending)
        .mockResolvedValueOnce(
          liveInvitation({ revokedAt: new Date() }),
        );

      const revoked = await service.revoke(pending.id);

      expect(update).toHaveBeenCalledTimes(1);
      expect(revoked.status).toBe(SignUpInvitationStatusEnum.Revoked);
    });
  });
});
