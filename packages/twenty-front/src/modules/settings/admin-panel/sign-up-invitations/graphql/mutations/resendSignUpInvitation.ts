import { gql } from '@apollo/client';

import { SIGN_UP_INVITATION_FRAGMENT } from '@/settings/admin-panel/sign-up-invitations/graphql/fragments/signUpInvitationFragment';

export const RESEND_SIGN_UP_INVITATION = gql`
  ${SIGN_UP_INVITATION_FRAGMENT}
  mutation ResendSignUpInvitation($id: UUID!, $locale: String) {
    resendSignUpInvitation(id: $id, locale: $locale) {
      ...SignUpInvitationFragment
    }
  }
`;
