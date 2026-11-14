import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createStore, Provider } from 'jotai';
import { useForm } from 'react-hook-form';

import { SettingsAccountsNewConnectionFlow } from '@/settings/accounts/components/SettingsAccountsNewConnectionFlow';
import {
  type ConnectionFormData,
  DEFAULT_PROTOCOL_VALUES,
} from '@/settings/accounts/hooks/useImapSmtpCaldavConnectionForm';

let latestForm: ReturnType<typeof useForm<ConnectionFormData>>;

const Wrapper = () => {
  latestForm = useForm<ConnectionFormData>({
    defaultValues: { name: '', handle: '', ...DEFAULT_PROTOCOL_VALUES },
  });
  return <SettingsAccountsNewConnectionFlow formMethods={latestForm} />;
};

const renderFlow = () =>
  render(
    <Provider store={createStore()}>
      <I18nProvider i18n={i18n}>
        <Wrapper />
      </I18nProvider>
    </Provider>,
  );

it('fills Gmail servers, copies the email to usernames and submits the full-form shape', async () => {
  renderFlow();

  await userEvent.click(
    screen.getByRole('button', { name: 'Gmail / Google Workspace' }),
  );
  await userEvent.type(screen.getByLabelText('Email Address'), 'ana@gmail.com');
  await userEvent.type(screen.getByLabelText('Password'), 'app-secret');

  expect(screen.queryByLabelText('IMAP Server')).not.toBeInTheDocument();
  expect(latestForm.getValues()).toEqual({
    name: '',
    handle: 'ana@gmail.com',
    IMAP: {
      host: 'imap.gmail.com',
      port: 993,
      connectionSecurity: 'SSL_TLS',
      username: 'ana@gmail.com',
      password: 'app-secret',
    },
    SMTP: {
      host: 'smtp.gmail.com',
      port: 465,
      connectionSecurity: 'SSL_TLS',
      username: 'ana@gmail.com',
      password: 'app-secret',
    },
    CALDAV: DEFAULT_PROTOCOL_VALUES.CALDAV,
  });
});

it('shows prefilled values under advanced settings', async () => {
  renderFlow();

  await userEvent.click(
    screen.getByRole('button', { name: 'Gmail / Google Workspace' }),
  );
  await userEvent.click(
    screen.getByRole('button', { name: 'Advanced settings' }),
  );

  expect(screen.getByLabelText('IMAP Server')).toHaveValue('imap.gmail.com');
  expect(screen.getByLabelText('SMTP Server')).toHaveValue('smtp.gmail.com');
  expect(screen.getByLabelText('SMTP Port')).toHaveValue(465);
});

it('shows the complete empty form for Other', async () => {
  renderFlow();

  await userEvent.click(
    screen.getByRole('button', { name: 'Other / own domain' }),
  );

  expect(screen.getByLabelText('IMAP Server')).toHaveValue('');
  expect(screen.getByLabelText('SMTP Server')).toHaveValue('');
  expect(latestForm.getValues('IMAP.host')).toBe('');
  expect(latestForm.getValues('SMTP.host')).toBe('');
});

it('enables CalDAV for iCloud', async () => {
  renderFlow();

  await userEvent.click(screen.getByRole('button', { name: 'iCloud' }));

  expect(latestForm.getValues('CALDAV.host')).toBe('caldav.icloud.com');
});

it.each([
  [
    'Outlook.com / Hotmail',
    /Outlook\.com and Hotmail accounts with a password/,
  ],
  [
    'Microsoft 365 (business)',
    /Microsoft 365 no longer allows receiving email/,
  ],
])('shows a notice and no password field for %s', async (label, notice) => {
  renderFlow();

  await userEvent.click(screen.getByRole('button', { name: label }));

  expect(screen.getByText(notice)).toBeVisible();
  expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Email Address')).not.toBeInTheDocument();
});

it.each([
  ['Outlook.com / Hotmail', 'outlook.office365.com', 'smtp-mail.outlook.com'],
  ['Microsoft 365 (business)', 'outlook.office365.com', 'smtp.office365.com'],
])(
  'opens the prefilled full form from the notice for %s',
  async (label, imap, smtp) => {
    renderFlow();

    await userEvent.click(screen.getByRole('button', { name: label }));
    await userEvent.click(
      screen.getByRole('button', { name: 'Use "Other" with manual details' }),
    );

    expect(screen.getByLabelText('IMAP Server')).toHaveValue(imap);
    expect(screen.getByLabelText('SMTP Server')).toHaveValue(smtp);
  },
);

it('shows the 2-step verification and Workspace help for Gmail', async () => {
  renderFlow();

  await userEvent.click(
    screen.getByRole('button', { name: 'Gmail / Google Workspace' }),
  );

  expect(
    screen.getByText(
      'You need 2-step verification turned on and an app password.',
    ),
  ).toBeVisible();
  expect(
    screen.getByText(
      'In Google Workspace, your administrator may have turned off app passwords.',
    ),
  ).toBeVisible();
  expect(
    screen.getByRole('link', { name: 'Create an app password' }),
  ).toHaveAttribute('href', 'https://myaccount.google.com/apppasswords');
});
