import { createAtomState } from '@/ui/utilities/state/jotai/utils/createAtomState';

// Fail-closed: this is the value every consumer renders with until
// /client-config answers, so defaulting to true sends the first icon request to
// the external provider on a deployment that has the flag off.
export const allowRequestsToTwentyIconsState = createAtomState<boolean>({
  key: 'allowRequestsToTwentyIcons',
  defaultValue: false,
});
