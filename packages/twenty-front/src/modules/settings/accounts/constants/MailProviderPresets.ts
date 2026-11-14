import { msg } from '@lingui/core/macro';
import { type MessageDescriptor } from '@lingui/core';

import { OTHER_MAIL_PROVIDER_ID } from '@/settings/accounts/constants/OtherMailProviderId';
import { type MailProviderServer } from '@/settings/accounts/types/MailProviderServer';
import { buildMailProviderServer } from '@/settings/accounts/utils/buildMailProviderServer';
import { EmailConnectionSecurity } from '~/generated-metadata/graphql';

export type MailProviderPreset = {
  id: string;
  label: MessageDescriptor;
  passwordSignIn?: 'supported' | 'unsupported';
  unsupportedNotice?: MessageDescriptor;
  helpLine?: MessageDescriptor;
  extraNote?: MessageDescriptor;
  appPasswordUrl?: string;
  IMAP?: MailProviderServer;
  SMTP?: MailProviderServer;
  CALDAV?: MailProviderServer;
};

export const MAIL_PROVIDER_PRESETS: MailProviderPreset[] = [
  {
    id: 'google',
    label: msg`Gmail / Google Workspace`,
    passwordSignIn: 'supported',
    helpLine: msg`You need 2-step verification turned on and an app password.`,
    extraNote: msg`In Google Workspace, your administrator may have turned off app passwords.`,
    appPasswordUrl: 'https://myaccount.google.com/apppasswords',
    IMAP: buildMailProviderServer(
      'imap.gmail.com',
      993,
      EmailConnectionSecurity.SSL_TLS,
    ),
    SMTP: buildMailProviderServer(
      'smtp.gmail.com',
      465,
      EmailConnectionSecurity.SSL_TLS,
    ),
  },
  {
    id: 'outlook',
    label: msg`Outlook.com / Hotmail`,
    passwordSignIn: 'unsupported',
    unsupportedNotice: msg`Microsoft no longer allows connecting Outlook.com and Hotmail accounts with a password. Soon you will be able to connect yours by signing in with your Microsoft account.`,
    IMAP: buildMailProviderServer(
      'outlook.office365.com',
      993,
      EmailConnectionSecurity.SSL_TLS,
    ),
    SMTP: buildMailProviderServer(
      'smtp-mail.outlook.com',
      587,
      EmailConnectionSecurity.STARTTLS,
    ),
  },
  {
    id: 'microsoft365',
    label: msg`Microsoft 365 (business)`,
    passwordSignIn: 'unsupported',
    unsupportedNotice: msg`Microsoft 365 no longer allows receiving email with a password, and sending with a password is turned off at the end of 2026. Soon you will be able to connect yours by signing in with your Microsoft account. If your company keeps IMAP and SMTP with a password enabled, use "Other".`,
    IMAP: buildMailProviderServer(
      'outlook.office365.com',
      993,
      EmailConnectionSecurity.SSL_TLS,
    ),
    SMTP: buildMailProviderServer(
      'smtp.office365.com',
      587,
      EmailConnectionSecurity.STARTTLS,
    ),
  },
  {
    id: 'icloud',
    label: msg`iCloud`,
    passwordSignIn: 'supported',
    helpLine: msg`Create an app-specific password in your Apple account and paste it here.`,
    appPasswordUrl: 'https://account.apple.com/account/manage',
    IMAP: buildMailProviderServer(
      'imap.mail.me.com',
      993,
      EmailConnectionSecurity.SSL_TLS,
    ),
    SMTP: buildMailProviderServer(
      'smtp.mail.me.com',
      587,
      EmailConnectionSecurity.STARTTLS,
    ),
    CALDAV: buildMailProviderServer(
      'caldav.icloud.com',
      443,
      EmailConnectionSecurity.SSL_TLS,
    ),
  },
  {
    id: 'yahoo',
    label: msg`Yahoo`,
    passwordSignIn: 'supported',
    helpLine: msg`Generate an app password in your Yahoo account security page and paste it here.`,
    appPasswordUrl: 'https://login.yahoo.com/myaccount/security/app-password',
    IMAP: buildMailProviderServer(
      'imap.mail.yahoo.com',
      993,
      EmailConnectionSecurity.SSL_TLS,
    ),
    SMTP: buildMailProviderServer(
      'smtp.mail.yahoo.com',
      465,
      EmailConnectionSecurity.SSL_TLS,
    ),
  },
  {
    id: 'zoho',
    label: msg`Zoho`,
    passwordSignIn: 'supported',
    helpLine: msg`Generate an application-specific password in your Zoho account security page and paste it here.`,
    appPasswordUrl: 'https://accounts.zoho.com/home#security/app_password',
    IMAP: buildMailProviderServer(
      'imap.zoho.com',
      993,
      EmailConnectionSecurity.SSL_TLS,
    ),
    SMTP: buildMailProviderServer(
      'smtp.zoho.com',
      465,
      EmailConnectionSecurity.SSL_TLS,
    ),
  },
  {
    id: OTHER_MAIL_PROVIDER_ID,
    label: msg`Other / own domain`,
  },
];
