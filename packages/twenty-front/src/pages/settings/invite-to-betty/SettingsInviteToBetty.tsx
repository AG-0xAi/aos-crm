import { currentUserState } from '@/auth/states/currentUserState';
import { SettingsAdminSignUpInvitations } from '@/settings/admin-panel/sign-up-invitations/components/SettingsAdminSignUpInvitations';
import { SettingsPageContainer } from '@/settings/components/SettingsPageContainer';
import { SettingsPageLayout } from '@/settings/components/layout/SettingsPageLayout';
import { useAtomStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomStateValue';
import { t } from '@lingui/core/macro';
import { Navigate } from 'react-router-dom';
import { SettingsPath } from 'twenty-shared/types';
import { getSettingsPath } from 'twenty-shared/utils';

export const SettingsInviteToBetty = () => {
  const currentUser = useAtomStateValue(currentUserState);

  if (currentUser?.canAccessFullAdminPanel !== true) {
    return <Navigate to={getSettingsPath(SettingsPath.ProfilePage)} replace />;
  }

  return (
    <SettingsPageLayout
      title={t`Invite someone to Betty`}
      links={[
        {
          children: t`Settings`,
          href: getSettingsPath(SettingsPath.ProfilePage),
        },
        { children: t`Invite someone to Betty` },
      ]}
    >
      <SettingsPageContainer>
        <SettingsAdminSignUpInvitations />
      </SettingsPageContainer>
    </SettingsPageLayout>
  );
};
