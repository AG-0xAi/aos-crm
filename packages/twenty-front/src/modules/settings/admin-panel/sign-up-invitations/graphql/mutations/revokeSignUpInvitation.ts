import { gql } from '@apollo/client';

import { SIGN_UP_INVITATION_FRAGMENT } from '@/settings/admin-panel/sign-up-invitations/graphql/fragments/signUpInvitationFragment';

export const REVOKE_SIGN_UP_INVITATION = gql`
  ${SIGN_UP_INVITATION_FRAGMENT}
  mutation RevokeSignUpInvitation($id: UUID!) {
    revokeSignUpInvitation(id: $id) {
      ...SignUpInvitationFragment
    }
  }
`;
