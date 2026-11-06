import { useApolloAdminClient } from '@/settings/admin-panel/apollo/hooks/useApolloAdminClient';
import { GET_SIGN_UP_INVITATIONS } from '@/settings/admin-panel/sign-up-invitations/graphql/queries/getSignUpInvitations';
import { CombinedGraphQLErrors } from '@apollo/client/errors';
import { useMutation, useQuery } from '@apollo/client/react';
import { t } from '@lingui/core/macro';
import { i18n } from '@lingui/core';
import { useState } from 'react';
import { useToast } from 'twenty-ui/components/feedback';
import {
  CreateSignUpInvitationDocument,
  ResendSignUpInvitationDocument,
  RevokeSignUpInvitationDocument,
  GetSignUpInvitationsDocument,
} from '~/generated-admin/graphql';
import { getErrorMessageFromApolloError } from '~/utils/get-error-message-from-apollo-error.util';

export const useSignUpInvitations = () => {
  const apolloAdminClient = useApolloAdminClient();
  const { enqueueToast } = useToast();
  const [pendingInvitationId, setPendingInvitationId] = useState<string | null>(
    null,
  );

  const { data, loading, error } = useQuery(GetSignUpInvitationsDocument, {
    client: apolloAdminClient,
  });

  const mutationOptions = {
    client: apolloAdminClient,
    refetchQueries: [{ query: GET_SIGN_UP_INVITATIONS }],
    awaitRefetchQueries: true,
  };

  const [createMutation] = useMutation(
    CreateSignUpInvitationDocument,
    mutationOptions,
  );
  const [resendMutation] = useMutation(
    ResendSignUpInvitationDocument,
    mutationOptions,
  );
  const [revokeMutation] = useMutation(
    RevokeSignUpInvitationDocument,
    mutationOptions,
  );

  const run = async (
    invitationId: string | null,
    action: () => Promise<unknown>,
    successMessage: string,
    fallbackErrorMessage: string,
  ) => {
    setPendingInvitationId(invitationId);

    try {
      await action();
      enqueueToast({ status: 'success', children: successMessage });

      return true;
    } catch (mutationError) {
      enqueueToast({
        status: 'error',
        children: CombinedGraphQLErrors.is(mutationError)
          ? getErrorMessageFromApolloError(mutationError)
          : fallbackErrorMessage,
      });

      return false;
    } finally {
      setPendingInvitationId(null);
    }
  };

  // The invited person has no account yet, so there is no stored preference:
  // the e-mail goes out in the language the operator is reading.
  const locale = i18n.locale;

  return {
    invitations: data?.getSignUpInvitations ?? [],
    loading,
    error,
    pendingInvitationId,
    createInvitation: (email: string) =>
      run(
        null,
        () => createMutation({ variables: { email, locale } }),
        t`Invitation sent`,
        t`Could not send the invitation. Please try again later.`,
      ),
    resendInvitation: (id: string) =>
      run(
        id,
        () => resendMutation({ variables: { id, locale } }),
        t`Invitation sent again with a new link`,
        t`Could not resend the invitation. Please try again later.`,
      ),
    revokeInvitation: (id: string) =>
      run(
        id,
        () => revokeMutation({ variables: { id } }),
        t`Invitation revoked`,
        t`Could not revoke the invitation. Please try again later.`,
      ),
  };
};
