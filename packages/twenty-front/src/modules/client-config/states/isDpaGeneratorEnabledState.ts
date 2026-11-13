import { createAtomState } from '@/ui/utilities/state/jotai/utils/createAtomState';

export const isDpaGeneratorEnabledState = createAtomState<boolean>({
  key: 'isDpaGeneratorEnabled',
  defaultValue: false,
});
