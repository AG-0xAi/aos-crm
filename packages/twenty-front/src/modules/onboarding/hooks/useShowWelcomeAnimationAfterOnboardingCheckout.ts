import { currentUserState } from '@/auth/states/currentUserState';
import { isOnboardingAiChatEnabledState } from '@/client-config/states/isOnboardingAiChatEnabledState';
import { isBettyWelcomeVisibleState } from '@/onboarding/states/isBettyWelcomeVisibleState';
import { isOnboardingCheckoutPendingState } from '@/onboarding/states/isOnboardingCheckoutPendingState';
import { shouldOpenAiChatAfterOnboardingState } from '@/onboarding/states/shouldOpenAiChatAfterOnboardingState';
import { useStore } from 'jotai';
import { OnboardingStatus } from '~/generated-metadata/graphql';

export const useShowWelcomeAnimationAfterOnboardingCheckout = () => {
  const store = useStore();

  return () => {
    if (!store.get(isOnboardingCheckoutPendingState.atom)) {
      return;
    }

    const onboardingStatus = store.get(currentUserState.atom)?.onboardingStatus;

    if (onboardingStatus !== OnboardingStatus.COMPLETED) {
      return;
    }

    const isOnboardingAiChatEnabled = store.get(
      isOnboardingAiChatEnabledState.atom,
    );

    store.set(isOnboardingCheckoutPendingState.atom, false);
    store.set(isBettyWelcomeVisibleState.atom, true);
    store.set(
      shouldOpenAiChatAfterOnboardingState.atom,
      isOnboardingAiChatEnabled,
    );
  };
};
