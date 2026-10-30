import { useCallback, useState } from 'react';

import { onboardingConfigState } from '@/client-config/states/onboardingConfigState';
import { useSetNextOnboardingStatus } from '@/onboarding/hooks/useSetNextOnboardingStatus';
import { useSetOnboardingStepFreeCredits } from '@/onboarding/hooks/useSetOnboardingStepFreeCredits';
import { getInviteTeamCreditsReward } from '@/onboarding/utils/getInviteTeamCreditsReward';
import { useCreateWorkspaceInvitation } from '@/workspace-invitation/hooks/useCreateWorkspaceInvitation';
import { useStore } from 'jotai';
import { isDefined } from 'twenty-shared/utils';

// Leaving this step has to be recorded on the SERVER, not only in local state:
// the status is derived from ONBOARDING_INVITE_TEAM_PENDING, and
// completeOnboardingInviteTeamStep (the only writer that clears it) runs inside
// sendInvitations. Sending zero invitations is therefore how this step is
// marked done -- the same call the invite form made when it was skipped -- and
// it creates no invitation and sends no mail.
export const useConnectAssistantStep = () => {
  const { sendInvitation } = useCreateWorkspaceInvitation();
  const setNextOnboardingStatus = useSetNextOnboardingStatus();
  const setOnboardingStepFreeCredits = useSetOnboardingStepFreeCredits();
  const store = useStore();

  const [isNavigating, setIsNavigating] = useState(false);

  const goToCrm = useCallback(async () => {
    if (isNavigating) {
      return;
    }

    setIsNavigating(true);

    try {
      const result = await sendInvitation({ emails: [] });

      if (isDefined(result.error)) {
        throw result.error;
      }

      setOnboardingStepFreeCredits(
        'inviteTeam',
        getInviteTeamCreditsReward({
          invitedTeammatesCount: 0,
          onboardingConfig: store.get(onboardingConfigState.atom),
        }),
      );

      setNextOnboardingStatus({ stepHistoryEffect: 'recordAsReversible' });
    } catch (error) {
      setIsNavigating(false);

      throw error;
    }
  }, [
    isNavigating,
    sendInvitation,
    setNextOnboardingStatus,
    setOnboardingStepFreeCredits,
    store,
  ]);

  return { goToCrm, isNavigating };
};
