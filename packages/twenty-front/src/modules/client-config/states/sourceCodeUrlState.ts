import { createAtomState } from '@/ui/utilities/state/jotai/utils/createAtomState';

export const sourceCodeUrlState = createAtomState<string | undefined>({
  key: 'sourceCodeUrl',
  defaultValue: undefined,
});
