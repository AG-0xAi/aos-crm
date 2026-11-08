import { MockedProvider } from '@apollo/client/testing/react';
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { render, screen } from '@testing-library/react';
import { Provider as JotaiProvider } from 'jotai';
import { type ReactNode } from 'react';
import { SOURCE_LOCALE } from 'twenty-shared/translations';

import { currentUserState } from '@/auth/states/currentUserState';
import { currentWorkspaceState } from '@/auth/states/currentWorkspaceState';
import { onboardingConfigState } from '@/client-config/states/onboardingConfigState';
import { type OnboardingConfig } from '@/client-config/types/OnboardingConfig';
import { OnboardingLayout } from '@/onboarding/components/OnboardingLayout';
import type * as OnboardingLayoutModule from '@/onboarding/components/OnboardingLayout';
import { OnboardingStepLayout } from '@/onboarding/components/OnboardingStepLayout';
import { ONBOARDING_FREE_CREDITS_DEFAULT_VALUE } from '@/onboarding/constants/OnboardingFreeCreditsDefaultValue';
import { onboardingFreeCreditsFamilyState } from '@/onboarding/states/onboardingFreeCreditsFamilyState';
import {
  jotaiStore,
  resetJotaiStore,
} from '@/ui/utilities/state/jotai/jotaiStore';
import { ToastProvider } from 'twenty-ui/components/feedback';
import { OnboardingStatus } from '~/generated-metadata/graphql';
import { messages } from '~/locales/generated/en';
import {
  mockCurrentWorkspace,
  mockedUserData,
} from '~/testing/mock-data/users';

jest.mock(
  '@/onboarding/effect-components/PrefetchPlanRequiredStepEffect',
  () => ({
    PrefetchPlanRequiredStepEffect: () => null,
  }),
);

jest.mock('@/onboarding/components/OnboardingTransitionOutlet', () => ({
  OnboardingTransitionOutlet: () => null,
}));

// Spies through to the real implementation, so the other tests in this file
// (which rely on OnboardingLayout actually rendering headerRightComponent and
// children) keep working, while letting the backgroundComponent assertions
// below inspect the exact props OnboardingStepLayout passed it.
jest.mock('@/onboarding/components/OnboardingLayout', () => {
  const actual: typeof OnboardingLayoutModule = jest.requireActual(
    '@/onboarding/components/OnboardingLayout',
  );
  return {
    ...actual,
    OnboardingLayout: jest.fn(actual.OnboardingLayout),
  };
});

i18n.load({ [SOURCE_LOCALE]: messages });
i18n.activate(SOURCE_LOCALE);

const onboardingConfig: OnboardingConfig = {
  importContactsCreditsReward: 2,
  inviteTeamCreditsRewardPerUser: 3,
  createProfileCreditsReward: 0.5,
  upgradeCreditsReward: 5,
  inviteTeamMaxInvites: 3,
};

const Wrapper = ({ children }: { children: ReactNode }) => (
  <MockedProvider mocks={[]}>
    <JotaiProvider store={jotaiStore}>
      <ToastProvider>
        <I18nProvider i18n={i18n}>{children}</I18nProvider>
      </ToastProvider>
    </JotaiProvider>
  </MockedProvider>
);

const setOnboardingStatus = (onboardingStatus: OnboardingStatus) =>
  jotaiStore.set(currentUserState.atom, {
    ...mockedUserData,
    isWorkspaceCreator: true,
    onboardingStatus,
  });

describe('OnboardingStepLayout', () => {
  beforeEach(() => {
    localStorage.clear();
    resetJotaiStore();
    jotaiStore.set(currentWorkspaceState.atom, mockCurrentWorkspace);
    jest.mocked(OnboardingLayout).mockClear();
  });

  it('should invite to earn the email reward on the first step', async () => {
    jotaiStore.set(onboardingConfigState.atom, onboardingConfig);
    setOnboardingStatus(OnboardingStatus.SYNC_EMAIL);

    render(<OnboardingStepLayout />, { wrapper: Wrapper });

    expect(await screen.findByText('Earn 2')).toBeInTheDocument();
  });

  it('should display the free credits won out of the steps done so far', async () => {
    jotaiStore.set(onboardingConfigState.atom, onboardingConfig);
    setOnboardingStatus(OnboardingStatus.PROFILE_CREATION);
    jotaiStore.set(
      onboardingFreeCreditsFamilyState.atomFamily(mockCurrentWorkspace.id),
      {
        ...ONBOARDING_FREE_CREDITS_DEFAULT_VALUE,
        importContacts: 1.5,
        seenCredits: 1.5,
      },
    );

    render(<OnboardingStepLayout />, { wrapper: Wrapper });

    const freeCreditsLabel = await screen.findByText('free credits');

    expect(freeCreditsLabel.parentElement).toHaveTextContent('1.5/2');
  });

  it('should hide the free credits pill when credits rewards are not configured', () => {
    jotaiStore.set(onboardingConfigState.atom, null);

    setOnboardingStatus(OnboardingStatus.SYNC_EMAIL);

    render(<OnboardingStepLayout />, { wrapper: Wrapper });

    expect(screen.queryByText('Earn 2')).not.toBeInTheDocument();
  });

  it('should never pass a backgroundComponent to OnboardingLayout, on the first step', () => {
    jotaiStore.set(onboardingConfigState.atom, onboardingConfig);
    setOnboardingStatus(OnboardingStatus.SYNC_EMAIL);

    const { container } = render(<OnboardingStepLayout />, {
      wrapper: Wrapper,
    });

    expect(jest.mocked(OnboardingLayout)).toHaveBeenCalled();
    for (const [props] of jest.mocked(OnboardingLayout).mock.calls) {
      expect(props.backgroundComponent).toBeUndefined();
    }
    expect(container.querySelector('canvas')).not.toBeInTheDocument();
  });

  it('should never pass a backgroundComponent to OnboardingLayout, on the last onboarding step', () => {
    jotaiStore.set(onboardingConfigState.atom, onboardingConfig);
    setOnboardingStatus(OnboardingStatus.PLAN_REQUIRED);

    const { container } = render(<OnboardingStepLayout />, {
      wrapper: Wrapper,
    });

    expect(jest.mocked(OnboardingLayout)).toHaveBeenCalled();
    for (const [props] of jest.mocked(OnboardingLayout).mock.calls) {
      expect(props.backgroundComponent).toBeUndefined();
    }
    expect(container.querySelector('canvas')).not.toBeInTheDocument();
  });
});
