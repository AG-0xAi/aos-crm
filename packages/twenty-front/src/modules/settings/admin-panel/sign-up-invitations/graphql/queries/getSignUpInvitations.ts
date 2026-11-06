import { gql } from '@apollo/client';

import { SIGN_UP_INVITATION_FRAGMENT } from '@/settings/admin-panel/sign-up-invitations/graphql/fragments/signUpInvitationFragment';

export const GET_SIGN_UP_INVITATIONS = gql`
  ${SIGN_UP_INVITATION_FRAGMENT}
  query GetSignUpInvitations {
    getSignUpInvitations {
      ...SignUpInvitationFragment
    }
  }
`;
