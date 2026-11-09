import { MockedProvider } from '@apollo/client/testing/react';
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { render, screen } from '@testing-library/react';
import { Provider as JotaiProvider } from 'jotai';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SOURCE_LOCALE } from 'twenty-shared/translations';
import { ToastProvider } from 'twenty-ui/components/feedback';

import {
  type CurrentUser,
  currentUserState,
} from '@/auth/states/currentUserState';
import { GET_SIGN_UP_INVITATIONS } from '@/settings/admin-panel/sign-up-invitations/graphql/queries/getSignUpInvitations';
import {
  jotaiStore,
  resetJotaiStore,
} from '@/ui/utilities/state/jotai/jotaiStore';
import { SettingsInviteToBetty } from '~/pages/settings/invite-to-betty/SettingsInviteToBetty';
import { dynamicActivate } from '~/utils/i18n/dynamicActivate';

dynamicActivate(SOURCE_LOCALE);

const SIGN_UP_INVITATIONS_MOCK = {
  request: { query: GET_SIGN_UP_INVITATIONS },
  result: { data: { getSignUpInvitations: [] } },
};

const renderPage = () =>
  render(
    <MockedProvider mocks={[SIGN_UP_INVITATIONS_MOCK]}>
      <JotaiProvider store={jotaiStore}>
        <MemoryRouter initialEntries={['/settings/invite-to-betty']}>
          <I18nProvider i18n={i18n}>
            <ToastProvider>
              <Routes>
                <Route
                  path="/settings/invite-to-betty"
                  element={<SettingsInviteToBetty />}
                />
                <Route
                  path="/settings/profile"
                  element={<div>Profile page</div>}
                />
              </Routes>
            </ToastProvider>
          </I18nProvider>
        </MemoryRouter>
      </JotaiProvider>
    </MockedProvider>,
  );

describe('SettingsInviteToBetty', () => {
  beforeEach(() => {
    resetJotaiStore();
  });

  it('shows the invite page to a user with admin-panel access', async () => {
    jotaiStore.set(currentUserState.atom, {
      canAccessFullAdminPanel: true,
    } as CurrentUser);

    renderPage();

    expect(
      screen.getAllByText('Invite someone to Betty').length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText('Profile page')).not.toBeInTheDocument();
    await screen.findAllByText('Invite someone to Betty');
  });

  it('redirects a user without admin-panel access to their profile settings', () => {
    jotaiStore.set(currentUserState.atom, {
      canAccessFullAdminPanel: false,
    } as CurrentUser);

    renderPage();

    expect(screen.getByText('Profile page')).toBeInTheDocument();
    expect(screen.queryAllByText('Invite someone to Betty').length).toBe(0);
  });
});
