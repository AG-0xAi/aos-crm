import { gql } from '@apollo/client';

export const CREATE_SIGN_UP_INVITATION = gql`
  mutation CreateSignUpInvitation($email: String!, $locale: String) {
    createSignUpInvitation(email: $email, locale: $locale) {
      ...SignUpInvitationFragment
    }
  }
`;
