import { gql } from '@apollo/client';

export const RESEND_SIGN_UP_INVITATION = gql`
  mutation ResendSignUpInvitation($id: UUID!, $locale: String) {
    resendSignUpInvitation(id: $id, locale: $locale) {
      ...SignUpInvitationFragment
    }
  }
`;
