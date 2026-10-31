import { gql } from '@apollo/client';

export const SIGN_UP = gql`
  mutation SignUp(
    $email: String!
    $password: String!
    $captchaToken: String
    $locale: String
    $verifyEmailRedirectPath: String
    $signUpInvitationToken: String
  ) {
    signUp(
      email: $email
      password: $password
      captchaToken: $captchaToken
      locale: $locale
      verifyEmailRedirectPath: $verifyEmailRedirectPath
      signUpInvitationToken: $signUpInvitationToken
    ) {
      availableWorkspaces {
        ...AvailableWorkspacesFragment
      }
      tokens {
        ...AuthTokenPairFragment
      }
    }
  }
`;
