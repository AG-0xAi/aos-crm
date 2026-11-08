import { MockedProvider } from '@apollo/client/testing/react';
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { act, renderHook } from '@testing-library/react';
import { Provider as JotaiProvider } from 'jotai';
import { createElement, type ReactNode } from 'react';
import { SOURCE_LOCALE } from 'twenty-shared/translations';
import { ToastProvider } from 'twenty-ui/components/feedback';

import { currentUserState } from '@/auth/states/currentUserState';
import { currentWorkspaceState } from '@/auth/states/currentWorkspaceState';
import { onboardingConfigState } from '@/client-config/states/onboardingConfigState';
import { useConnectAssistantStep } from '@/onboarding/hooks/useConnectAssistantStep';
import { onboardingFreeCreditsFamilyState } from '@/onboarding/states/onboardingFreeCreditsFamilyState';
import {
  jotaiStore,
  resetJotaiStore,
} from '@/ui/utilities/state/jotai/jotaiStore';
import {
  OnboardingStatus,
  SendInvitationsDocument,
} from '~/generated-metadata/graphql';
import { messages } from '~/locales/generated/en';
import {
  mockCurrentWorkspace,
  mockedUserData,
} from '~/testing/mock-data/users';

i18n.load({ [SOURCE_LOCALE]: messages });
i18n.activate(SOURCE_LOCALE);

const skipInvitationMock = {
  request: { query: SendInvitationsDocument, variables: { emails: [] } },
  maxUsageCount: Number.POSITIVE_INFINITY,
  result: {
    data: {
      sendInvitations: { success: true, errors: [], result: [] },
    },
  },
};

const sendOneInvitationMock = {
  request: {
    query: SendInvitationsDocument,
    variables: { emails: ['teammate@example.com'] },
  },
  maxUsageCount: Number.POSITIVE_INFINITY,
  result: {
    data: {
      sendInvitations: {
        success: true,
        errors: [],
        result: [
          {
            __typename: 'WorkspaceInvitation',
            id: 'invitation-id',
            email: 'teammate@example.com',
            roleId: null,
            expiresAt: '2026-12-31T00:00:00.000Z',
          },
        ],
      },
    },
  },
};

const renderConnectAssistantStepHook = () => {
  jotaiStore.set(currentWorkspaceState.atom, mockCurrentWorkspace);
  jotaiStore.set(onboardingConfigState.atom, {
    importContactsCreditsReward: 2,
    inviteTeamCreditsRewardPerUser: 0.5,
    createProfileCreditsReward: 0.5,
    upgradeCreditsReward: 4,
    inviteTeamMaxInvites: 4,
  });
  jotaiStore.set(currentUserState.atom, {
    ...mockedUserData,
    isWorkspaceCreator: true,
    onboardingStatus: OnboardingStatus.INVITE_TEAM,
  });

  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(
      MockedProvider,
      { mocks: [skipInvitationMock, sendOneInvitationMock] as never },
      createElement(
        JotaiProvider,
        { store: jotaiStore },
        createElement(
          ToastProvider,
          null,
          createElement(I18nProvider, { i18n }, children),
        ),
      ),
    );

  return renderHook(() => useConnectAssistantStep(), { wrapper });
};

describe('useConnectAssistantStep', () => {
  beforeEach(() => {
    resetJotaiStore();
  });

  it('completes the step and advances onboarding when skipped with no emails', async () => {
    const { result } = renderConnectAssistantStepHook();

    await act(async () => {
      await result.current.completeStep([]);
    });

    expect(jotaiStore.get(currentUserState.atom)?.onboardingStatus).toBe(
      OnboardingStatus.COMPLETED,
    );
    expect(
      jotaiStore.get(
        onboardingFreeCreditsFamilyState.atomFamily(mockCurrentWorkspace.id),
      ).inviteTeam,
    ).toBe(0);
  });

  it('completes the step, sends the invitation and records the credits reward when teammates are invited', async () => {
    const { result } = renderConnectAssistantStepHook();

    await act(async () => {
      await result.current.completeStep(['teammate@example.com']);
    });

    expect(jotaiStore.get(currentUserState.atom)?.onboardingStatus).toBe(
      OnboardingStatus.COMPLETED,
    );
    expect(
      jotaiStore.get(
        onboardingFreeCreditsFamilyState.atomFamily(mockCurrentWorkspace.id),
      ).inviteTeam,
    ).toBe(0.5);
  });
});
