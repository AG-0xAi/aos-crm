import { gql } from '@apollo/client';

import { SIGN_UP_INVITATION_FRAGMENT } from '@/settings/admin-panel/sign-up-invitations/graphql/fragments/signUpInvitationFragment';

export const CREATE_SIGN_UP_INVITATION = gql`
  ${SIGN_UP_INVITATION_FRAGMENT}
  mutation CreateSignUpInvitation($email: String!, $locale: String) {
    createSignUpInvitation(email: $email, locale: $locale) {
      ...SignUpInvitationFragment
    }
  }
`;
