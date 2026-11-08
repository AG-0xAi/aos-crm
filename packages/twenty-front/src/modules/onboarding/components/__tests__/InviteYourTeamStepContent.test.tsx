import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider as JotaiProvider } from 'jotai';
import { type ReactNode } from 'react';
import { SOURCE_LOCALE } from 'twenty-shared/translations';
import { ToastProvider } from 'twenty-ui/components/feedback';

import { InviteYourTeamStepContent } from '@/onboarding/components/InviteYourTeamStepContent';
import {
  jotaiStore,
  resetJotaiStore,
} from '@/ui/utilities/state/jotai/jotaiStore';
import { messages } from '~/locales/generated/en';

i18n.load({ [SOURCE_LOCALE]: messages });
i18n.activate(SOURCE_LOCALE);

const Wrapper = ({ children }: { children: ReactNode }) => (
  <JotaiProvider store={jotaiStore}>
    <ToastProvider>
      <I18nProvider i18n={i18n}>{children}</I18nProvider>
    </ToastProvider>
  </JotaiProvider>
);

describe('InviteYourTeamStepContent', () => {
  beforeEach(() => {
    resetJotaiStore();
  });

  it('sends the sanitized, deduplicated email list when the form is valid', async () => {
    const onSendInvitations = jest.fn();
    const onSkip = jest.fn();

    render(
      <InviteYourTeamStepContent
        isSubmitting={false}
        onSendInvitations={onSendInvitations}
        onSkip={onSkip}
      />,
      { wrapper: Wrapper },
    );

    await userEvent.type(
      screen.getByRole('textbox'),
      'Teammate@Example.com, teammate@example.com, second@example.com',
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Send invitations' }),
    );

    expect(onSendInvitations).toHaveBeenCalledWith([
      'teammate@example.com',
      'second@example.com',
    ]);
    expect(onSkip).not.toHaveBeenCalled();
  });

  it('blocks sending and shows the error when an email is invalid', async () => {
    const onSendInvitations = jest.fn();
    const onSkip = jest.fn();

    render(
      <InviteYourTeamStepContent
        isSubmitting={false}
        onSendInvitations={onSendInvitations}
        onSkip={onSkip}
      />,
      { wrapper: Wrapper },
    );

    await userEvent.type(screen.getByRole('textbox'), 'not-an-email');
    await userEvent.click(
      screen.getByRole('button', { name: 'Send invitations' }),
    );

    expect(
      await screen.findByText('Invalid email: not-an-email'),
    ).toBeInTheDocument();
    expect(onSendInvitations).not.toHaveBeenCalled();
    expect(onSkip).not.toHaveBeenCalled();
  });

  it('skips without requiring a valid email', async () => {
    const onSendInvitations = jest.fn();
    const onSkip = jest.fn();

    render(
      <InviteYourTeamStepContent
        isSubmitting={false}
        onSendInvitations={onSendInvitations}
        onSkip={onSkip}
      />,
      { wrapper: Wrapper },
    );

    await userEvent.click(screen.getByRole('button', { name: 'Skip' }));

    expect(onSkip).toHaveBeenCalledTimes(1);
    expect(onSendInvitations).not.toHaveBeenCalled();
  });
});
