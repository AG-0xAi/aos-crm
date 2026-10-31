import { SignUpInvitationStatusEnum } from 'src/engine/core-modules/sign-up-invitation/enums/sign-up-invitation-status.enum';
import { getSignUpInvitationStatus } from 'src/engine/core-modules/sign-up-invitation/utils/get-sign-up-invitation-status.util';

const NOW = new Date('2026-10-31T12:00:00.000Z');
const LATER = new Date('2026-11-07T12:00:00.000Z');
const EARLIER = new Date('2026-10-24T12:00:00.000Z');

describe('getSignUpInvitationStatus', () => {
  it('is pending while it is live', () => {
    expect(
      getSignUpInvitationStatus(
        { expiresAt: LATER, revokedAt: null, context: { email: 'a@b.test' } },
        NOW,
      ),
    ).toBe(SignUpInvitationStatusEnum.Pending);
  });

  it('is expired once its expiry has passed', () => {
    expect(
      getSignUpInvitationStatus(
        { expiresAt: EARLIER, revokedAt: null, context: { email: 'a@b.test' } },
        NOW,
      ),
    ).toBe(SignUpInvitationStatusEnum.Expired);
  });

  it('is expired on the exact expiry instant', () => {
    expect(
      getSignUpInvitationStatus(
        { expiresAt: NOW, revokedAt: null, context: { email: 'a@b.test' } },
        NOW,
      ),
    ).toBe(SignUpInvitationStatusEnum.Expired);
  });

  it('is revoked when the operator revoked it', () => {
    expect(
      getSignUpInvitationStatus(
        { expiresAt: LATER, revokedAt: NOW, context: { email: 'a@b.test' } },
        NOW,
      ),
    ).toBe(SignUpInvitationStatusEnum.Revoked);
  });

  // Redemption sets revokedAt too, so "used" has to win over "revoked" or a
  // consumed invitation would read as one the operator cancelled.
  it('is used, not revoked, once it was redeemed', () => {
    expect(
      getSignUpInvitationStatus(
        {
          expiresAt: EARLIER,
          revokedAt: NOW,
          context: { email: 'a@b.test', consumedAt: NOW.toISOString() },
        },
        NOW,
      ),
    ).toBe(SignUpInvitationStatusEnum.Used);
  });
});
