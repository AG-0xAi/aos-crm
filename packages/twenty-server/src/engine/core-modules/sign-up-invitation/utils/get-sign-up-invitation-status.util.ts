import { isDefined } from 'twenty-shared/utils';

import { type AppTokenEntity } from 'src/engine/core-modules/app-token/app-token.entity';
import { SignUpInvitationStatusEnum } from 'src/engine/core-modules/sign-up-invitation/enums/sign-up-invitation-status.enum';

// Redemption and revocation both set revokedAt, so the order here is what tells
// them apart: context.consumedAt is only ever written by a redemption.
export const getSignUpInvitationStatus = (
  invitation: Pick<AppTokenEntity, 'expiresAt' | 'revokedAt' | 'context'>,
  now: Date = new Date(),
): SignUpInvitationStatusEnum => {
  if (isDefined(invitation.context?.consumedAt)) {
    return SignUpInvitationStatusEnum.Used;
  }

  if (isDefined(invitation.revokedAt)) {
    return SignUpInvitationStatusEnum.Revoked;
  }

  if (new Date(invitation.expiresAt) <= now) {
    return SignUpInvitationStatusEnum.Expired;
  }

  return SignUpInvitationStatusEnum.Pending;
};
