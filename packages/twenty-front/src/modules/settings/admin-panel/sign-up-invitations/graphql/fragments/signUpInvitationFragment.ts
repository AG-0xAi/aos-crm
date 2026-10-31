import { gql } from '@apollo/client';

export const SIGN_UP_INVITATION_FRAGMENT = gql`
  fragment SignUpInvitationFragment on SignUpInvitation {
    id
    email
    status
    createdAt
    expiresAt
    consumedAt
    revokedAt
  }
`;
