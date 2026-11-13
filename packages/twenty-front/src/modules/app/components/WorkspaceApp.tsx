import { RouterProvider } from 'react-router-dom';

import { AppNavigatorProvider } from '@/app/components/AppNavigatorProvider';
import { useCreateWorkspaceAppRouter } from '@/app/hooks/useCreateWorkspaceAppRouter';
import { currentUserState } from '@/auth/states/currentUserState';
import { isDpaGeneratorEnabledState } from '@/client-config/states/isDpaGeneratorEnabledState';
import { useAtomStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomStateValue';

export const WorkspaceApp = () => {
  const currentUser = useAtomStateValue(currentUserState);
  const isDpaGeneratorEnabled = useAtomStateValue(isDpaGeneratorEnabledState);

  const isAdminPageEnabled =
    (currentUser?.canImpersonate || currentUser?.canAccessFullAdminPanel) ??
    false;

  const router = useCreateWorkspaceAppRouter({
    isAdminPageEnabled,
    isDpaGeneratorEnabled,
  });

  return (
    <AppNavigatorProvider router={router}>
      <RouterProvider useTransitions={false} router={router} />
    </AppNavigatorProvider>
  );
};
