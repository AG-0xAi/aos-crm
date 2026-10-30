import { isDefined } from 'twenty-shared/utils';

import { helpCenterUrlState } from '@/client-config/states/helpCenterUrlState';
import { useAtomStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomStateValue';

// The deployment's own help centre (HELP_CENTER_URL), or undefined when it has
// none. Callers must HIDE their link on undefined: there is no fallback
// documentation site, and a dead "Documentation" entry teaches users to
// distrust the ones that work.
//
// `path` is appended as given, so a help centre with a different information
// architecture is free to serve its own root instead.
export const useHelpCenterUrl = (path?: string): string | undefined => {
  const helpCenterUrl = useAtomStateValue(helpCenterUrlState);

  if (!isDefined(helpCenterUrl)) {
    return undefined;
  }

  if (!isDefined(path)) {
    return helpCenterUrl;
  }

  return `${helpCenterUrl.replace(/\/+$/, '')}${path}`;
};
