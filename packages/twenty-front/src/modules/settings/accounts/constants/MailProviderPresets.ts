import { msg } from '@lingui/core/macro';
import { type MessageDescriptor } from '@lingui/core';

import { OTHER_MAIL_PROVIDER_ID } from '@/settings/accounts/constants/OtherMailProviderId';
import { type MailProviderServer } from '@/settings/accounts/types/MailProviderServer';
import { buildMailProviderServer } from '@/settings/accounts/utils/buildMailProviderServer';
import { EmailConnectionSecurity } from '~/generated-metadata/graphql';

export type MailProviderPreset = {
  id: string;
  label: MessageDescriptor;
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
    helpLine: msg`Turn on 2-step verification in your Google account, then create an app password and paste it here.`,
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
    helpLine: msg`Turn on 2-step verification in your Microsoft account, then create an app password and paste it here.`,
    appPasswordUrl: 'https://account.live.com/proofs/AppPassword',
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
    helpLine: msg`Create an app password in your Microsoft security info page and paste it here.`,
    extraNote: msg`If your company has blocked this access, your administrator must enable IMAP and SMTP for your account.`,
    appPasswordUrl: 'https://mysignins.microsoft.com/security-info',
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
