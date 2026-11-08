import { MockedProvider } from '@apollo/client/testing/react';
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ReactNode } from 'react';
import { SOURCE_LOCALE } from 'twenty-shared/translations';
import { ToastProvider } from 'twenty-ui/components/feedback';

import { AppToaster } from '@/ui/feedback/toast/components/AppToaster';
import { WorkspaceInviteTeam } from '@/workspace/components/WorkspaceInviteTeam';
import {
  GetWorkspaceInvitationsDocument,
  SendInvitationsDocument,
} from '~/generated-metadata/graphql';
import { messages } from '~/locales/generated/en';

i18n.load({ [SOURCE_LOCALE]: messages });
i18n.activate(SOURCE_LOCALE);

const refetchMock = {
  request: { query: GetWorkspaceInvitationsDocument },
  maxUsageCount: Number.POSITIVE_INFINITY,
  result: { data: { findWorkspaceInvitations: [] } },
};

const sendOneInvitationMock = {
  request: {
    query: SendInvitationsDocument,
    variables: { emails: ['teammate@example.com'] },
  },
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

const Wrapper = ({ children }: { children: ReactNode }) => (
  <MockedProvider mocks={[sendOneInvitationMock, refetchMock]}>
    <ToastProvider>
      <I18nProvider i18n={i18n}>
        {children}
        <AppToaster />
      </I18nProvider>
    </ToastProvider>
  </MockedProvider>
);

const renderForm = () =>
  render(<WorkspaceInviteTeam roles={[]} />, {
    wrapper: Wrapper,
  });

describe('WorkspaceInviteTeam (Settings > Members > Invite by email)', () => {
  it('is reachable and says nothing about Twenty', () => {
    const { container } = renderForm();

    expect(screen.getByRole('textbox')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Invite' })).toBeDisabled();
    expect(container.textContent).not.toMatch(/twenty/i);
  });

  it('sends the invitation and reports success once an address is typed', async () => {
    renderForm();

    await userEvent.type(screen.getByRole('textbox'), 'teammate@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Invite' }));

    expect(await screen.findByText(/invitations sent/)).toBeInTheDocument();
  });

  it('blocks the invalid email instead of sending it', async () => {
    renderForm();

    await userEvent.type(screen.getByRole('textbox'), 'not-an-email');
    await userEvent.click(screen.getByRole('button', { name: 'Invite' }));

    expect(
      await screen.findByText('Invalid email: not-an-email'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/invitations sent/)).not.toBeInTheDocument();
  });
});
