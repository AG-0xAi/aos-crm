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
import { type SignupWebhookService } from 'src/engine/core-modules/signup-webhook/services/signup-webhook.service';
import { type TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';

jest.mock('twenty-emails', () => ({
  SignUpInviteLinkEmail: jest.fn(() => ({ template: true })),
  renderEmail: jest.fn(async () => 'rendered'),
}));

const PLAIN_TOKEN = 'a'.repeat(64);
const EMAIL = 'ana@example.test';
const INVITATION_ID = '11111111-1111-4111-8111-111111111111';

const liveInvitation = (overrides: Partial<AppTokenEntity> = {}) =>
  ({
    id: INVITATION_ID,
    type: AppTokenType.SignUpInvitationToken,
    value: hashSignUpInvitationToken(PLAIN_TOKEN),
    expiresAt: new Date(Date.now() + 86_400_000),
    createdAt: new Date(),
    revokedAt: null,
    deletedAt: null,
    context: { email: EMAIL },
    ...overrides,
  }) as AppTokenEntity;

// A stateful fake rather than per-call mocks: create() and resend() both read
// the row back after writing it (save() on an existing id is an UPDATE, whose
// returned entity carries no createdAt), so call-order mocks would make the
// assertions about mock bookkeeping instead of about behaviour.
const buildService = ({
  rows = [] as AppTokenEntity[],
  liveForEmail = null as AppTokenEntity | null,
} = {}) => {
  const store = new Map(rows.map((row) => [row.id, { ...row }]));

  const appTokenRepository = {
    find: jest.fn(async () => [...store.values()]),
    findOne: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
      // The by-email duplicate lookup is the only one carrying a jsonb matcher.
      if ('context' in where) return liveForEmail;
      if (typeof where.id === 'string') return store.get(where.id) ?? null;
      if (typeof where.value === 'string') {
        return (
          [...store.values()].find((row) => row.value === where.value) ?? null
        );
      }

      return null;
    }),
    create: jest.fn((entity) => entity),
    save: jest.fn(async (entity: Partial<AppTokenEntity>) => {
      const id = entity.id ?? INVITATION_ID;
      const existing = store.get(id);
      const saved = {
        ...liveInvitation(),
        ...existing,
        ...entity,
        id,
        createdAt: existing?.createdAt ?? new Date(),
      } as AppTokenEntity;

      store.set(id, saved);

      return entity.id === undefined
        ? { ...saved, createdAt: undefined }
        : { id };
    }),
    update: jest.fn(async (id: string, patch: Partial<AppTokenEntity>) => {
      const existing = store.get(id);
      if (existing) store.set(id, { ...existing, ...patch } as AppTokenEntity);

      return { affected: existing ? 1 : 0 };
    }),
  } as unknown as jest.Mocked<Repository<AppTokenEntity>>;

  const emailService = {
    send: jest.fn(),
  } as unknown as jest.Mocked<EmailService>;

  const twentyConfigService = {
    get: jest.fn((key: string) =>
      key === 'SIGN_UP_INVITATION_TOKEN_EXPIRES_IN' ? '7d' : 'Betty',
    ),
  } as unknown as TwentyConfigService;

  const workspaceDomainsService = {
    getSubdomainAndCustomDomainFromWorkspaceFallbackOnDefaultSubdomain: jest.fn(
      () => ({
        subdomain: 'app',
        customDomain: null,
        isCustomDomainEnabled: false,
      }),
    ),
    buildWorkspaceURL: jest.fn(
      ({ pathname, searchParams }) =>
        new URL(
          `http://app.localhost${pathname}?${new URLSearchParams(searchParams as Record<string, string>).toString()}`,
        ),
    ),
  } as unknown as WorkspaceDomainsService;

  const i18nService = {
    getI18nInstance: jest.fn(() => ({
      _: (message: unknown) => String(message),
    })),
  } as unknown as I18nService;

  const signupWebhookService = {
    enqueue: jest.fn(async () => undefined),
  } as unknown as SignupWebhookService;

  const service = new SignUpInvitationService(
    appTokenRepository,
    twentyConfigService,
    workspaceDomainsService,
    emailService,
    i18nService,
    signupWebhookService,
  );

  return {
    service,
    appTokenRepository,
    emailService,
    signupWebhookService,
    store,
  };
};

// Indexed and not .at(-1): twenty-server's tsconfig lib predates it (TS2550).
const mailedLink = () => {
  const { calls } = (
    jest.requireMock('twenty-emails') as { SignUpInviteLinkEmail: jest.Mock }
  ).SignUpInviteLinkEmail.mock;

  return calls[calls.length - 1][0].link as string;
};

const mailedToken = () =>
  new URL(mailedLink()).searchParams.get(
    SIGN_UP_INVITATION_TOKEN_SEARCH_PARAM,
  ) as string;

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
      const { service, appTokenRepository } = buildService({
        rows: [liveInvitation()],
      });

      await expect(
        service.findLiveInvitationForEmail({
          plainToken: PLAIN_TOKEN,
          email: EMAIL,
        }),
      ).resolves.toBeDefined();

      const where = appTokenRepository.findOne.mock.calls[0][0].where as Record<
        string,
        unknown
      >;

      expect(where.value).toBe(hashSignUpInvitationToken(PLAIN_TOKEN));
      expect(where.value).not.toBe(PLAIN_TOKEN);
      expect(where.type).toBe(AppTokenType.SignUpInvitationToken);
    });

    it('refuses an invitation addressed to another mailbox', async () => {
      const { service } = buildService({ rows: [liveInvitation()] });

      await expect(
        service.findLiveInvitationForEmail({
          plainToken: PLAIN_TOKEN,
          email: 'someone.else@example.test',
        }),
      ).resolves.toBeUndefined();
    });

    it('accepts the invited mailbox whatever its case or padding', async () => {
      const { service } = buildService({ rows: [liveInvitation()] });

      await expect(
        service.findLiveInvitationForEmail({
          plainToken: PLAIN_TOKEN,
          email: ' Ana@Example.Test ',
        }),
      ).resolves.toBeDefined();
    });
  });

  describe('consumeWithinTransaction', () => {
    // Annotated: the stub's methods return the stub, and without a type the
    // self-reference in its own initializer is TS7022/TS7024.
    type QueryBuilderStub = {
      update: jest.Mock;
      set: jest.Mock;
      where: jest.Mock;
      andWhere: jest.Mock;
      setParameter: jest.Mock;
      execute: jest.Mock;
    };

    const entityManagerWithAffected = (affected: number | null | undefined) => {
      const builder: QueryBuilderStub = {
        update: jest.fn(() => builder),
        set: jest.fn(() => builder),
        where: jest.fn(() => builder),
        andWhere: jest.fn(() => builder),
        setParameter: jest.fn(() => builder),
        execute: jest.fn(async () => ({ affected })),
      };

      return {
        entityManager: { createQueryBuilder: jest.fn(() => builder) },
        builder,
      };
    };

    it('consumes the invitation only while it is still live', async () => {
      const { service } = buildService();
      const { entityManager, builder } = entityManagerWithAffected(1);

      await service.consumeWithinTransaction({
        entityManager: entityManager as never,
        invitationId: INVITATION_ID,
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
            invitationId: INVITATION_ID,
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
      const { service, emailService } = buildService({
        liveForEmail: liveInvitation(),
      });

      await expect(
        service.create({ email: EMAIL, issuedByUserId: 'operator' }),
      ).rejects.toMatchObject({ code: AuthExceptionCode.INVALID_INPUT });
      expect(emailService.send).not.toHaveBeenCalled();
    });

    it('stores only the hash and mails a link carrying the plaintext', async () => {
      const {
        service,
        appTokenRepository,
        emailService,
        signupWebhookService,
        store,
      } = buildService();

      const created = await service.create({
        email: ' Ana@Example.Test ',
        issuedByUserId: 'operator',
        locale: 'en',
      });

      expect(created.email).toBe(EMAIL);
      expect(created.status).toBe(SignUpInvitationStatusEnum.Pending);
      expect(created.createdAt).toBeInstanceOf(Date);
      expect(created.consumedAt).toBeNull();

      const saved = appTokenRepository.save.mock
        .calls[0][0] as unknown as AppTokenEntity;

      expect(saved.value).toHaveLength(64);
      expect(saved.context?.email).toBe(EMAIL);
      expect(saved.context?.issuedByUserId).toBe('operator');

      const { html } = emailService.send.mock.calls[0][0] as { html: string };

      expect(html).toBe('rendered');

      const token = mailedToken();

      expect(token).toHaveLength(64);
      expect(hashSignUpInvitationToken(token)).toBe(
        store.get(created.id)?.value,
      );
      expect(mailedLink()).not.toContain(store.get(created.id)?.value);

      expect(signupWebhookService.enqueue).toHaveBeenCalledWith({
        event: 'signup_invitation.created',
        email: EMAIL,
        locale: 'en',
        expiresAt: created.expiresAt.toISOString(),
      });
    });
  });

  describe('resend and revoke', () => {
    it('refuses to resend a redeemed invitation', async () => {
      const redeemed = liveInvitation({
        revokedAt: new Date(),
        context: { email: EMAIL, consumedAt: new Date().toISOString() },
      });
      const { service, emailService } = buildService({ rows: [redeemed] });

      await expect(service.resend({ id: INVITATION_ID })).rejects.toMatchObject(
        { code: AuthExceptionCode.INVALID_INPUT },
      );
      expect(emailService.send).not.toHaveBeenCalled();
    });

    it('refuses to resend a revoked invitation', async () => {
      const { service, emailService } = buildService({
        rows: [liveInvitation({ revokedAt: new Date() })],
      });

      await expect(service.resend({ id: INVITATION_ID })).rejects.toMatchObject(
        { code: AuthExceptionCode.INVALID_INPUT },
      );
      expect(emailService.send).not.toHaveBeenCalled();
    });

    it('rotates the token in place when it resends an expired invitation', async () => {
      const expired = liveInvitation({
        expiresAt: new Date(Date.now() - 1000),
      });
      const { service, emailService, store } = buildService({
        rows: [expired],
      });

      const resent = await service.resend({ id: INVITATION_ID });

      expect(resent.id).toBe(INVITATION_ID);
      expect(resent.status).toBe(SignUpInvitationStatusEnum.Pending);
      expect(store.get(INVITATION_ID)?.value).not.toBe(expired.value);
      expect(hashSignUpInvitationToken(mailedToken())).toBe(
        store.get(INVITATION_ID)?.value,
      );
      expect(emailService.send).toHaveBeenCalledTimes(1);
    });

    it('refuses to revoke a redeemed invitation', async () => {
      const { service, appTokenRepository } = buildService({
        rows: [
          liveInvitation({
            revokedAt: new Date(),
            context: { email: EMAIL, consumedAt: new Date().toISOString() },
          }),
        ],
      });

      await expect(service.revoke(INVITATION_ID)).rejects.toMatchObject({
        code: AuthExceptionCode.INVALID_INPUT,
      });
      expect(appTokenRepository.update).not.toHaveBeenCalled();
    });

    it('revokes a pending invitation', async () => {
      const { service, appTokenRepository } = buildService({
        rows: [liveInvitation()],
      });

      const revoked = await service.revoke(INVITATION_ID);

      expect(appTokenRepository.update).toHaveBeenCalledTimes(1);
      expect(revoked.status).toBe(SignUpInvitationStatusEnum.Revoked);
      expect(revoked.revokedAt).toBeInstanceOf(Date);
    });
  });
});
