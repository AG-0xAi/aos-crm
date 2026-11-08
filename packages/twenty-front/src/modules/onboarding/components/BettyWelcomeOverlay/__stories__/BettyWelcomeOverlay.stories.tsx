import { currentUserState } from '@/auth/states/currentUserState';
import { BettyWelcomeOverlay } from '@/onboarding/components/BettyWelcomeOverlay/BettyWelcomeOverlay';
import { isBettyWelcomeVisibleState } from '@/onboarding/states/isBettyWelcomeVisibleState';
import { jotaiStore } from '@/ui/utilities/state/jotai/jotaiStore';
import { type Meta, type StoryObj } from '@storybook/react-vite';
import { useEffect } from 'react';
import { RootDecorator } from '~/testing/decorators/RootDecorator';
import { mockedUserData } from '~/testing/mock-data/users';
import { OnboardingStatus } from '~/generated-metadata/graphql';

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

// Forces the reduced-motion query result instead of relying on the host's
// actual OS preference, so the story renders deterministically either way.
const mockReducedMotionPreference = (matches: boolean) => {
  const originalMatchMedia = window.matchMedia;
  const reducedMotionMedia = {
    matches,
    media: REDUCED_MOTION_QUERY,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  } as unknown as MediaQueryList;

  window.matchMedia = (query) =>
    query === REDUCED_MOTION_QUERY
      ? reducedMotionMedia
      : originalMatchMedia(query);

  return () => {
    window.matchMedia = originalMatchMedia;
  };
};

type BettyWelcomeOverlayExampleProps = {
  prefersReducedMotion?: boolean;
};

const BettyWelcomeOverlayExample = ({
  prefersReducedMotion = false,
}: BettyWelcomeOverlayExampleProps) => {
  useEffect(() => {
    const restoreMatchMedia = mockReducedMotionPreference(prefersReducedMotion);

    jotaiStore.set(currentUserState.atom, {
      ...mockedUserData,
      firstName: 'Charles',
      onboardingStatus: OnboardingStatus.COMPLETED,
    });
    jotaiStore.set(isBettyWelcomeVisibleState.atom, true);

    return () => {
      jotaiStore.set(isBettyWelcomeVisibleState.atom, false);
      restoreMatchMedia();
    };
  }, [prefersReducedMotion]);

  return <BettyWelcomeOverlay />;
};

const meta: Meta<typeof BettyWelcomeOverlayExample> = {
  title: 'Modules/Onboarding/BettyWelcomeOverlay',
  component: BettyWelcomeOverlayExample,
  decorators: [RootDecorator],
};

export default meta;

type Story = StoryObj<typeof BettyWelcomeOverlayExample>;

export const Default: Story = {
  args: { prefersReducedMotion: false },
};

export const ReducedMotion: Story = {
  args: { prefersReducedMotion: true },
};
