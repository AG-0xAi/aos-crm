import { i18n } from '@lingui/core';
import { messages as enMessages } from '~/locales/generated/en';
import { getPageTitleFromPath } from '~/utils/title-utils';

i18n.load('en', enMessages);
i18n.activate('en');

describe('title-utils', () => {
  it.each([
    ['/verify', 'Verify - Betty'],
    ['/welcome', 'Sign in or Create an account - Betty'],
    ['/invite/:workspaceInviteHash', 'Invite - Betty'],
    ['/workspace-activation', 'Create Workspace - Betty'],
    ['/create/profile', 'Create Profile - Betty'],
    ['/settings/objects/opportunities', 'Data model - Settings - Betty'],
    ['/settings/profile', 'Profile - Settings - Betty'],
    ['/settings/experience', 'Experience - Settings - Betty'],
    ['/settings/accounts', 'Account - Settings - Betty'],
    ['/settings/accounts/new', 'Account - Settings - Betty'],
    ['/settings/accounts/calendars', 'Account - Settings - Betty'],
    [
      '/settings/accounts/calendars/:accountUuid',
      'Account - Settings - Betty',
    ],
    ['/settings/accounts/emails', 'Account - Settings - Betty'],
    ['/settings/accounts/emails/:accountUuid', 'Account - Settings - Betty'],
    ['/settings/billing/plans', 'Billing - Settings - Betty'],
    ['/settings/members', 'Members - Settings - Betty'],
    ['/settings/general', 'General - Settings - Betty'],
  ])('should title %p as %p', (pathname, expected) => {
    expect(getPageTitleFromPath(pathname)).toBe(expected);
  });

  it('should not repeat the brand on the paths that are only the brand', () => {
    expect(getPageTitleFromPath('/')).toBe('Betty');
    expect(getPageTitleFromPath('/random')).toBe('Betty');
  });
});
