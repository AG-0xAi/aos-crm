import { createAtomState } from '@/ui/utilities/state/jotai/utils/createAtomState';

export const helpCenterUrlState = createAtomState<string | undefined>({
  key: 'helpCenterUrl',
  defaultValue: undefined,
});
