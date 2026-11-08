import { createAtomState } from '@/ui/utilities/state/jotai/utils/createAtomState';

export const isBettyWelcomeVisibleState = createAtomState<boolean>({
  key: 'isBettyWelcomeVisibleState',
  defaultValue: false,
});
