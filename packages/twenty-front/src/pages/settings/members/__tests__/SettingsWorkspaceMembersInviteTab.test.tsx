import { MockedProvider } from '@apollo/client/testing/react';
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { render, screen } from '@testing-library/react';
import { Provider as JotaiProvider } from 'jotai';
import { MemoryRouter } from 'react-router-dom';
import { SOURCE_LOCALE } from 'twenty-shared/translations';
import { ToastProvider } from 'twenty-ui/components/feedback';

import { currentWorkspaceState } from '@/auth/states/currentWorkspaceState';
import {
  jotaiStore,
  resetJotaiStore,
} from '@/ui/utilities/state/jotai/jotaiStore';
import {
  GetApprovedAccessDomainsDocument,
  GetRolesDocument,
  GetWorkspaceInvitationsDocument,
} from '~/generated-metadata/graphql';
import { SettingsWorkspaceMembersInviteTab } from '~/pages/settings/members/tabs/SettingsWorkspaceMembersInviteTab';
import { mockCurrentWorkspace } from '~/testing/mock-data/users';
import { dynamicActivate } from '~/utils/i18n/dynamicActivate';

dynamicActivate(SOURCE_LOCALE);

const MOCKS = [
  {
    request: { query: GetWorkspaceInvitationsDocument },
    result: { data: { findWorkspaceInvitations: [] } },
  },
  {
    request: { query: GetRolesDocument },
    result: { data: { getPermissionFlags: [], getRoles: [] } },
  },
  {
    request: { query: GetApprovedAccessDomainsDocument },
    result: { data: { getApprovedAccessDomains: [] } },
  },
];

const renderInviteTab = () =>
  render(
    <MockedProvider mocks={MOCKS}>
      <JotaiProvider store={jotaiStore}>
        <MemoryRouter>
          <I18nProvider i18n={i18n}>
            <ToastProvider>
              <SettingsWorkspaceMembersInviteTab />
            </ToastProvider>
          </I18nProvider>
        </MemoryRouter>
      </JotaiProvider>
    </MockedProvider>,
  );

describe('SettingsWorkspaceMembersInviteTab (Settings > Members > Invite)', () => {
  beforeEach(() => {
    resetJotaiStore();
    jotaiStore.set(currentWorkspaceState.atom, {
      ...mockCurrentWorkspace,
      displayName: 'Acme Inc',
      inviteHash: 'acme-invite-hash',
    });
  });

  it('shows the invite-by-email form and the copyable invite link, with no visible Twenty', async () => {
    const { container } = renderInviteTab();

    expect(
      screen.getByPlaceholderText('tim@apple.com, jony.ive@apple.dev'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Invite' })).toBeInTheDocument();

    const inviteLinkInput = await screen.findByDisplayValue(
      /\/invite\/acme-invite-hash$/,
    );
    expect(inviteLinkInput).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Copy link' }),
    ).toBeInTheDocument();

    expect(container.textContent).not.toMatch(/twenty/i);
  });
});
