import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import crypto from 'crypto';

import { msg } from '@lingui/core/macro';
import { addMilliseconds, differenceInMilliseconds } from 'date-fns';
import ms from 'ms';
import { SignUpInviteLinkEmail, renderEmail } from 'twenty-emails';
import { type APP_LOCALES, SOURCE_LOCALE } from 'twenty-shared/translations';
import { AppPath } from 'twenty-shared/types';
import { getAppPath, isDefined } from 'twenty-shared/utils';
import { IsNull, MoreThan, Raw, Repository, type EntityManager } from 'typeorm';

import {
  AppTokenEntity,
  AppTokenType,
} from 'src/engine/core-modules/app-token/app-token.entity';
import {
  AuthException,
  AuthExceptionCode,
} from 'src/engine/core-modules/auth/auth.exception';
import { WorkspaceDomainsService } from 'src/engine/core-modules/domain/workspace-domains/services/workspace-domains.service';
import { EmailService } from 'src/engine/core-modules/email/email.service';
import { I18nService } from 'src/engine/core-modules/i18n/i18n.service';
import { type SignUpInvitationDTO } from 'src/engine/core-modules/sign-up-invitation/dtos/sign-up-invitation.dto';
import { SignUpInvitationStatusEnum } from 'src/engine/core-modules/sign-up-invitation/enums/sign-up-invitation-status.enum';
import { getSignUpInvitationStatus } from 'src/engine/core-modules/sign-up-invitation/utils/get-sign-up-invitation-status.util';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';

const TOKEN_BYTES = 32;

export const SIGN_UP_INVITATION_TOKEN_SEARCH_PARAM = 'signUpInvitationToken';

export const hashSignUpInvitationToken = (plainToken: string) =>
  crypto.createHash('sha256').update(plainToken).digest('hex');

@Injectable()
export class SignUpInvitationService {
  constructor(
    @InjectRepository(AppTokenEntity)
    private readonly appTokenRepository: Repository<AppTokenEntity>,
    private readonly twentyConfigService: TwentyConfigService,
    private readonly workspaceDomainsService: WorkspaceDomainsService,
    private readonly emailService: EmailService,
    private readonly i18nService: I18nService,
  ) {}

  async findAll(): Promise<SignUpInvitationDTO[]> {
    const invitations = await this.appTokenRepository.find({
      where: { type: AppTokenType.SignUpInvitationToken, deletedAt: IsNull() },
      order: { createdAt: 'DESC' },
      select: { value: false },
    });

    return invitations.map((invitation) => this.toDTO(invitation));
  }

  async create({
    email,
    issuedByUserId,
    locale,
  }: {
    email: string;
    issuedByUserId: string;
    locale?: keyof typeof APP_LOCALES;
  }): Promise<SignUpInvitationDTO> {
    const normalizedEmail = this.normalizeEmail(email);

    if (isDefined(await this.findLiveInvitationByEmail(normalizedEmail))) {
      throw new AuthException(
        'That address already has a live sign-up invitation',
        AuthExceptionCode.INVALID_INPUT,
        {
          userFriendlyMessage: msg`This address already has a live invitation. Resend it, or revoke it first.`,
        },
      );
    }

    const { invitation, plainToken } = await this.mint({
      email: normalizedEmail,
      issuedByUserId,
    });

    await this.sendInvitationEmail({
      email: normalizedEmail,
      plainToken,
      expiresAt: invitation.expiresAt,
      locale,
    });

    return this.toDTO(invitation);
  }

  // Rotating rather than re-mailing the same token: after a resend exactly one
  // link is live, so a first e-mail that went to the wrong inbox stops working.
  async resend({
    id,
    locale,
  }: {
    id: string;
    locale?: keyof typeof APP_LOCALES;
  }): Promise<SignUpInvitationDTO> {
    const existing = await this.findByIdOrThrow(id);
    const status = getSignUpInvitationStatus(existing);

    if (status === SignUpInvitationStatusEnum.Used) {
      throw new AuthException(
        'A redeemed sign-up invitation cannot be resent',
        AuthExceptionCode.INVALID_INPUT,
        {
          userFriendlyMessage: msg`This invitation was already used to open a workspace.`,
        },
      );
    }

    if (status === SignUpInvitationStatusEnum.Revoked) {
      throw new AuthException(
        'A revoked sign-up invitation cannot be resent',
        AuthExceptionCode.INVALID_INPUT,
        {
          userFriendlyMessage: msg`This invitation was revoked. Invite the address again instead.`,
        },
      );
    }

    const email = this.emailOfOrThrow(existing);
    const { invitation, plainToken } = await this.mint({
      email,
      issuedByUserId: existing.context?.issuedByUserId,
      id: existing.id,
    });

    await this.sendInvitationEmail({
      email,
      plainToken,
      expiresAt: invitation.expiresAt,
      locale,
    });

    return this.toDTO(invitation);
  }

  async revoke(id: string): Promise<SignUpInvitationDTO> {
    const existing = await this.findByIdOrThrow(id);

    if (
      getSignUpInvitationStatus(existing) === SignUpInvitationStatusEnum.Used
    ) {
      throw new AuthException(
        'A redeemed sign-up invitation cannot be revoked',
        AuthExceptionCode.INVALID_INPUT,
        {
          userFriendlyMessage: msg`This invitation was already used to open a workspace.`,
        },
      );
    }

    await this.appTokenRepository.update(existing.id, {
      revokedAt: existing.revokedAt ?? new Date(),
    });

    return this.toDTO(await this.findByIdOrThrow(id));
  }

  // The live invitation this plaintext token opens for this address, or
  // undefined. Anything that is not live, matching, unexpired and unrevoked is
  // undefined with no reason attached: a caller must not learn which of the
  // four it was.
  async findLiveInvitationForEmail({
    plainToken,
    email,
  }: {
    plainToken?: string | null;
    email?: string | null;
  }): Promise<AppTokenEntity | undefined> {
    if (!isDefined(plainToken) || plainToken === '' || !isDefined(email)) {
      return undefined;
    }

    const invitation = await this.appTokenRepository.findOne({
      where: {
        value: hashSignUpInvitationToken(plainToken),
        type: AppTokenType.SignUpInvitationToken,
        deletedAt: IsNull(),
        revokedAt: IsNull(),
        expiresAt: MoreThan(new Date()),
      },
    });

    if (!isDefined(invitation)) {
      return undefined;
    }

    return invitation.context?.email === this.normalizeEmail(email)
      ? invitation
      : undefined;
  }

  // Single use, enforced by the database and inside the CALLER's transaction:
  // the conditional update is what makes two concurrent redemptions of one
  // token impossible, and rolling that transaction back un-consumes it, so a
  // workspace creation that fails does not burn the invitation.
  async consumeWithinTransaction({
    entityManager,
    invitationId,
    consumedByUserId,
  }: {
    entityManager: EntityManager;
    invitationId: string;
    consumedByUserId: string;
  }): Promise<void> {
    const now = new Date();
    const result = await entityManager
      .createQueryBuilder()
      .update(AppTokenEntity)
      .set({
        revokedAt: now,
        context: () => `coalesce("context", '{}'::jsonb) || :consumption::jsonb`,
      })
      .where('id = :invitationId', { invitationId })
      .andWhere('type = :type', { type: AppTokenType.SignUpInvitationToken })
      .andWhere('"revokedAt" IS NULL')
      .andWhere('"deletedAt" IS NULL')
      .andWhere('"expiresAt" > :now', { now })
      .setParameter(
        'consumption',
        JSON.stringify({
          consumedAt: now.toISOString(),
          consumedByUserId,
        }),
      )
      .execute();

    if (result.affected !== 1) {
      throw new AuthException(
        'The sign-up invitation was not live when it was redeemed',
        AuthExceptionCode.FORBIDDEN_EXCEPTION,
        {
          userFriendlyMessage: msg`This invitation link is no longer valid.`,
        },
      );
    }
  }

  private async mint({
    email,
    issuedByUserId,
    id,
  }: {
    email: string;
    issuedByUserId?: string;
    id?: string;
  }): Promise<{ invitation: AppTokenEntity; plainToken: string }> {
    const expiresIn = this.twentyConfigService.get(
      'SIGN_UP_INVITATION_TOKEN_EXPIRES_IN',
    );

    if (!expiresIn) {
      throw new AuthException(
        'SIGN_UP_INVITATION_TOKEN_EXPIRES_IN has no value',
        AuthExceptionCode.INTERNAL_SERVER_ERROR,
      );
    }

    const plainToken = crypto.randomBytes(TOKEN_BYTES).toString('hex');
    const invitation = await this.appTokenRepository.save(
      this.appTokenRepository.create({
        ...(isDefined(id) ? { id } : {}),
        type: AppTokenType.SignUpInvitationToken,
        value: hashSignUpInvitationToken(plainToken),
        expiresAt: addMilliseconds(new Date().getTime(), ms(expiresIn)),
        revokedAt: null,
        context: {
          email,
          ...(isDefined(issuedByUserId) ? { issuedByUserId } : {}),
        },
      }),
    );

    return { invitation, plainToken };
  }

  private async sendInvitationEmail({
    email,
    plainToken,
    expiresAt,
    locale,
  }: {
    email: string;
    plainToken: string;
    expiresAt: Date;
    locale?: keyof typeof APP_LOCALES;
  }): Promise<void> {
    const resolvedLocale = locale ?? SOURCE_LOCALE;
    const emailTemplate = SignUpInviteLinkEmail({
      link: this.buildSignUpLink({ plainToken, email }).toString(),
      duration: ms(differenceInMilliseconds(expiresAt, new Date()), {
        long: true,
      }),
      locale: resolvedLocale,
    });

    const html = await renderEmail(emailTemplate, { pretty: true });
    const text = await renderEmail(emailTemplate, { plainText: true });

    const invitedMsg = msg`You have been invited to Betty`;
    const i18n = this.i18nService.getI18nInstance(resolvedLocale);

    await this.emailService.send({
      from: `${this.twentyConfigService.get('EMAIL_FROM_NAME')} <${this.twentyConfigService.get('EMAIL_FROM_ADDRESS')}>`,
      to: email,
      subject: i18n._(invitedMsg),
      text,
      html,
    });
  }

  // The sign-up screen of the DEFAULT subdomain: the invited person has no
  // workspace yet, so there is no workspace host to send them to.
  private buildSignUpLink({
    plainToken,
    email,
  }: {
    plainToken: string;
    email: string;
  }): URL {
    return this.workspaceDomainsService.buildWorkspaceURL({
      workspace:
        this.workspaceDomainsService.getSubdomainAndCustomDomainFromWorkspaceFallbackOnDefaultSubdomain(
          null,
        ),
      pathname: getAppPath(AppPath.SignInUp),
      searchParams: {
        [SIGN_UP_INVITATION_TOKEN_SEARCH_PARAM]: plainToken,
        email,
      },
    });
  }

  private async findByIdOrThrow(id: string): Promise<AppTokenEntity> {
    const invitation = await this.appTokenRepository.findOne({
      where: {
        id,
        type: AppTokenType.SignUpInvitationToken,
        deletedAt: IsNull(),
      },
    });

    if (!isDefined(invitation)) {
      throw new AuthException(
        'Sign-up invitation not found',
        AuthExceptionCode.INVALID_INPUT,
        { userFriendlyMessage: msg`This invitation no longer exists.` },
      );
    }

    return invitation;
  }

  private findLiveInvitationByEmail(
    normalizedEmail: string,
  ): Promise<AppTokenEntity | null> {
    return this.appTokenRepository.findOne({
      where: {
        type: AppTokenType.SignUpInvitationToken,
        deletedAt: IsNull(),
        revokedAt: IsNull(),
        expiresAt: MoreThan(new Date()),
        context: Raw((alias) => `lower(${alias} ->> 'email') = lower(:email)`, {
          email: normalizedEmail,
        }),
      },
    });
  }

  private emailOfOrThrow(invitation: AppTokenEntity): string {
    const email = invitation.context?.email;

    if (!isDefined(email)) {
      throw new AuthException(
        'Sign-up invitation carries no address',
        AuthExceptionCode.INVALID_DATA,
      );
    }

    return email;
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private toDTO(invitation: AppTokenEntity): SignUpInvitationDTO {
    return {
      id: invitation.id,
      email: this.emailOfOrThrow(invitation),
      status: getSignUpInvitationStatus(invitation),
      createdAt: invitation.createdAt,
      expiresAt: invitation.expiresAt,
      consumedAt: isDefined(invitation.context?.consumedAt)
        ? new Date(invitation.context.consumedAt)
        : null,
      revokedAt: invitation.revokedAt,
    };
  }
}
