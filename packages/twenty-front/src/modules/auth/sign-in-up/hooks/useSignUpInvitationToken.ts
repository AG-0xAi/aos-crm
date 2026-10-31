import { SIGN_UP_INVITATION_TOKEN_SEARCH_PARAM } from '@/auth/sign-in-up/constants/SignUpInvitationTokenSearchParam';
import { useSearchParams } from 'react-router-dom';

// The operator's invitation, carried by the e-mailed link and read from the URL
// on both steps it unlocks: the sign-up itself and the workspace creation that
// follows it. Nothing stores it, so a reload cannot lose it while the link is
// still the address bar.
export const useSignUpInvitationToken = () => {
  const [searchParams] = useSearchParams();
  const signUpInvitationToken =
    searchParams.get(SIGN_UP_INVITATION_TOKEN_SEARCH_PARAM) ?? undefined;

  return {
    signUpInvitationToken,
    isSignUpInvitation:
      typeof signUpInvitationToken === 'string' &&
      signUpInvitationToken.length > 0,
  };
};
