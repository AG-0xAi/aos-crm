import { currentUserState } from '@/auth/states/currentUserState';
import { BettyWelcomeOverlay } from '@/onboarding/components/BettyWelcomeOverlay/BettyWelcomeOverlay';
import { isBettyWelcomeVisibleState } from '@/onboarding/states/isBettyWelcomeVisibleState';
import { isMinimalMetadataReadyState } from '@/metadata-store/states/isMinimalMetadataReadyState';
import { jotaiStore } from '@/ui/utilities/state/jotai/jotaiStore';
import { i18n } from '@lingui/core';
import { type Meta, type StoryObj } from '@storybook/react-vite';
import { useEffect } from 'react';
import { SOURCE_LOCALE } from 'twenty-shared/translations';
import { RootDecorator } from '~/testing/decorators/RootDecorator';
import { messages as esMessages } from '~/locales/generated/es-ES';
import { mockedUserData } from '~/testing/mock-data/users';
import { OnboardingStatus } from '~/generated-metadata/graphql';

i18n.load({ 'es-ES': esMessages });

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
  lang?: 'en' | 'es';
};

const BettyWelcomeOverlayExample = ({
  prefersReducedMotion = false,
  lang = 'en',
}: BettyWelcomeOverlayExampleProps) => {
  useEffect(() => {
    const restoreMatchMedia = mockReducedMotionPreference(prefersReducedMotion);

    i18n.activate(lang === 'es' ? 'es-ES' : SOURCE_LOCALE);
    jotaiStore.set(currentUserState.atom, {
      ...mockedUserData,
      firstName: 'Charles',
      isWorkspaceCreator: true,
      onboardingStatus: OnboardingStatus.COMPLETED,
    });
    // The dashboard behind the layer is ready by the time the story mounts:
    // the happy path, so the iris opens on schedule instead of pulsing for
    // up to BETTY_WELCOME_IRIS_PULSE_CAP_MS.
    jotaiStore.set(isMinimalMetadataReadyState.atom, true);
    jotaiStore.set(isBettyWelcomeVisibleState.atom, true);

    return () => {
      jotaiStore.set(isBettyWelcomeVisibleState.atom, false);
      jotaiStore.set(isMinimalMetadataReadyState.atom, false);
      i18n.activate(SOURCE_LOCALE);
      restoreMatchMedia();
    };
  }, [prefersReducedMotion, lang]);

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
  args: { prefersReducedMotion: false, lang: 'en' },
};

export const DefaultEs: Story = {
  args: { prefersReducedMotion: false, lang: 'es' },
};

export const ReducedMotion: Story = {
  args: { prefersReducedMotion: true, lang: 'en' },
};
