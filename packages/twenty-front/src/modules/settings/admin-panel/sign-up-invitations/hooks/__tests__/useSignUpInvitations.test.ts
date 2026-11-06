import { GET_SIGN_UP_INVITATIONS } from '@/settings/admin-panel/sign-up-invitations/graphql/queries/getSignUpInvitations';
import { CREATE_SIGN_UP_INVITATION } from '@/settings/admin-panel/sign-up-invitations/graphql/mutations/createSignUpInvitation';
import { RESEND_SIGN_UP_INVITATION } from '@/settings/admin-panel/sign-up-invitations/graphql/mutations/resendSignUpInvitation';
import { REVOKE_SIGN_UP_INVITATION } from '@/settings/admin-panel/sign-up-invitations/graphql/mutations/revokeSignUpInvitation';
import { Kind, type DocumentNode } from 'graphql';

// useSignUpInvitations.ts passes GET_SIGN_UP_INVITATIONS, unprinted, to
// refetchQueries: unlike useQuery/useMutation (which run against the
// *Document nodes generated-admin/graphql.ts bakes the fragment into), that
// document travels to the server exactly as written here. A document whose
// selection set spreads ...SignUpInvitationFragment without carrying the
// fragment's own definition is rejected by the server with "Unknown fragment"
// -- measured against the real admin-panel endpoint before this test existed.
const carriesSignUpInvitationFragment = (document: DocumentNode) =>
  document.definitions.some(
    (definition) =>
      definition.kind === Kind.FRAGMENT_DEFINITION &&
      definition.name.value === 'SignUpInvitationFragment',
  );

describe('sign-up-invitations graphql documents', () => {
  it.each([
    [
      'GET_SIGN_UP_INVITATIONS (sent by the hook via refetchQueries)',
      GET_SIGN_UP_INVITATIONS,
    ],
    ['CREATE_SIGN_UP_INVITATION', CREATE_SIGN_UP_INVITATION],
    ['RESEND_SIGN_UP_INVITATION', RESEND_SIGN_UP_INVITATION],
    ['REVOKE_SIGN_UP_INVITATION', REVOKE_SIGN_UP_INVITATION],
  ])(
    '%s carries the SignUpInvitationFragment definition',
    (_name, document) => {
      expect(carriesSignUpInvitationFragment(document)).toBe(true);
    },
  );
});
