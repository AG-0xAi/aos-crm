import { gql } from '@apollo/client';

export const GET_SIGN_UP_INVITATIONS = gql`
  query GetSignUpInvitations {
    getSignUpInvitations {
      ...SignUpInvitationFragment
    }
  }
`;
