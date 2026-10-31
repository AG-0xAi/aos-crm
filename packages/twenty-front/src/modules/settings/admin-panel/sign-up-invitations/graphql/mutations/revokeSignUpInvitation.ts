import { gql } from '@apollo/client';

export const REVOKE_SIGN_UP_INVITATION = gql`
  mutation RevokeSignUpInvitation($id: UUID!) {
    revokeSignUpInvitation(id: $id) {
      ...SignUpInvitationFragment
    }
  }
`;
