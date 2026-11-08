import { useCallback, useState } from 'react';

import { onboardingConfigState } from '@/client-config/states/onboardingConfigState';
import { useSetNextOnboardingStatus } from '@/onboarding/hooks/useSetNextOnboardingStatus';
import { useSetOnboardingStepFreeCredits } from '@/onboarding/hooks/useSetOnboardingStepFreeCredits';
import { getInviteTeamCreditsReward } from '@/onboarding/utils/getInviteTeamCreditsReward';
import { useCreateWorkspaceInvitation } from '@/workspace-invitation/hooks/useCreateWorkspaceInvitation';
import { useLingui } from '@lingui/react/macro';
import { useStore } from 'jotai';
import { isDefined, isNonEmptyArray } from 'twenty-shared/utils';
import { useToast } from 'twenty-ui/components/feedback';

// Leaving this step has to be recorded on the SERVER, not only in local state:
// the status is derived from ONBOARDING_INVITE_TEAM_PENDING, and
// completeOnboardingInviteTeamStep (the only writer that clears it) runs inside
// sendInvitations. completeStep([]) is therefore how the step is marked done
// when the optional invite sub-view is skipped -- it creates no invitation and
// sends no mail -- and completeStep(emails) is the same call with the
// addresses the invite sub-view actually collected.
export const useConnectAssistantStep = () => {
  const { t } = useLingui();
  const { sendInvitation } = useCreateWorkspaceInvitation();
  const setNextOnboardingStatus = useSetNextOnboardingStatus();
  const setOnboardingStepFreeCredits = useSetOnboardingStepFreeCredits();
  const { enqueueToast } = useToast();
  const store = useStore();

  const [isNavigating, setIsNavigating] = useState(false);

  const completeStep = useCallback(
    async (emails: string[]) => {
      if (isNavigating) {
        return;
      }

      setIsNavigating(true);

      try {
        const result = await sendInvitation({ emails });

        if (isDefined(result.error)) {
          throw result.error;
        }

        const invitedTeammatesCount =
          result.data?.sendInvitations.result.length ?? 0;
        const invitationErrors = result.data?.sendInvitations.errors ?? [];

        setOnboardingStepFreeCredits(
          'inviteTeam',
          getInviteTeamCreditsReward({
            invitedTeammatesCount,
            onboardingConfig: store.get(onboardingConfigState.atom),
          }),
        );

        if (
          invitedTeammatesCount === 0 &&
          isNonEmptyArray(emails) &&
          isNonEmptyArray(invitationErrors)
        ) {
          enqueueToast({
            status: 'error',
            children: invitationErrors.join(', '),
            duration: 5000,
          });
        }

        if (invitedTeammatesCount > 0) {
          enqueueToast({
            status: 'success',
            children: t`Invite link sent to email addresses`,
            duration: 2000,
          });
        }

        setNextOnboardingStatus({
          stepHistoryEffect:
            invitedTeammatesCount > 0
              ? 'clearAfterIrreversibleStep'
              : 'recordAsReversible',
        });
      } catch (error) {
        setIsNavigating(false);

        throw error;
      }
    },
    [
      enqueueToast,
      isNavigating,
      sendInvitation,
      setNextOnboardingStatus,
      setOnboardingStepFreeCredits,
      store,
      t,
    ],
  );

  return { completeStep, isNavigating };
};
