export const SIGNUP_INVITATION_CREATED_EVENT = 'signup_invitation.created';
export const USER_SIGNED_UP_EVENT = 'user.signed_up';

export type UserSignedUpVia =
  | 'signup_invitation'
  | 'workspace_invitation'
  | 'other';

export type SignupWebhookPayload =
  | {
      event: typeof SIGNUP_INVITATION_CREATED_EVENT;
      email: string;
      locale?: string | null;
      expiresAt: string;
    }
  | {
      event: typeof USER_SIGNED_UP_EVENT;
      email: string;
      firstName: string;
      lastName: string;
      locale?: string | null;
      workspace: { subdomain: string; displayName?: string };
      via: UserSignedUpVia;
    };

export type SignupWebhookJobData = SignupWebhookPayload & {
  occurredAt: string;
  app: 'betty';
  appVersion: string;
  webhookUrl: string;
};
