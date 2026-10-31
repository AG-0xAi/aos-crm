import { i18n } from '@lingui/core';
import { messages as enMessages } from '~/locales/generated/en';
import { getPageTitleFromPath } from '~/utils/title-utils';

i18n.load('en', enMessages);
i18n.activate('en');

const SECTION_TITLE_BY_PATH: Record<string, string> = {
  '/verify': 'Verify',
  '/welcome': 'Sign in or Create an account',
  '/invite/:workspaceInviteHash': 'Invite',
  '/workspace-activation': 'Create Workspace',
  '/create/profile': 'Create Profile',
  '/settings/objects/opportunities': 'Data model - Settings',
  '/settings/profile': 'Profile - Settings',
  '/settings/experience': 'Experience - Settings',
  '/settings/accounts': 'Account - Settings',
  '/settings/accounts/new': 'Account - Settings',
  '/settings/accounts/calendars': 'Account - Settings',
  '/settings/accounts/calendars/:accountUuid': 'Account - Settings',
  '/settings/accounts/emails': 'Account - Settings',
  '/settings/accounts/emails/:accountUuid': 'Account - Settings',
  '/settings/billing/plans': 'Billing - Settings',
  '/settings/members': 'Members - Settings',
  '/settings/general': 'General - Settings',
};

describe('title-utils', () => {
  it('should end every section title with the brand', () => {
    for (const [pathname, section] of Object.entries(SECTION_TITLE_BY_PATH)) {
      expect(getPageTitleFromPath(pathname)).toBe(`${section} - Betty`);
    }
  });

  it('should not repeat the brand where the title is only the brand', () => {
    expect(getPageTitleFromPath('/')).toBe('Betty');
    expect(getPageTitleFromPath('/random')).toBe('Betty');
  });
});
