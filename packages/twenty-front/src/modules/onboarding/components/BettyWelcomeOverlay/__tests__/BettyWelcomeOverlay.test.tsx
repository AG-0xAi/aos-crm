import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider as JotaiProvider } from 'jotai';
import { createElement, type ReactNode } from 'react';
import { SOURCE_LOCALE } from 'twenty-shared/translations';

import { currentUserState } from '@/auth/states/currentUserState';
import { BettyWelcomeOverlay } from '@/onboarding/components/BettyWelcomeOverlay/BettyWelcomeOverlay';
import {
  BETTY_WELCOME_DURATION_MS,
  BETTY_WELCOME_IRIS_OPEN_AT_MS,
  BETTY_WELCOME_IRIS_PULSE_CAP_MS,
  BETTY_WELCOME_SCENE_DURATIONS_MS,
} from '@/onboarding/components/BettyWelcomeOverlay/bettyWelcomeTimeline';
import { isBettyWelcomeVisibleState } from '@/onboarding/states/isBettyWelcomeVisibleState';
import { isMinimalMetadataReadyState } from '@/metadata-store/states/isMinimalMetadataReadyState';
import {
  jotaiStore,
  resetJotaiStore,
} from '@/ui/utilities/state/jotai/jotaiStore';
import { messages } from '~/locales/generated/en';
import { mockedUserData } from '~/testing/mock-data/users';
import { OnboardingStatus } from '~/generated-metadata/graphql';

i18n.load({ [SOURCE_LOCALE]: messages });
i18n.activate(SOURCE_LOCALE);

const Wrapper = ({ children }: { children: ReactNode }) =>
  createElement(
    JotaiProvider,
    { store: jotaiStore },
    createElement(
      I18nProvider,
      { i18n },
      createElement('button', { type: 'button' }, 'Dashboard action'),
      children,
    ),
  );

// The title's last word is wrapped in its own <span> for the underline, so its
// text is split across elements: match by role instead of by full text. The
// scene is aria-hidden (the live region carries the accessible announcement),
// so role queries need `hidden: true` to reach into it.
const queryTitleHeading = () =>
  screen.queryByRole('heading', { level: 2, hidden: true });

const mockMatchMedia = (matches: boolean) => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: jest.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    })),
  });
};

describe('BettyWelcomeOverlay', () => {
  beforeEach(() => {
    resetJotaiStore();
    jotaiStore.set(currentUserState.atom, {
      ...mockedUserData,
      onboardingStatus: OnboardingStatus.COMPLETED,
    });
    // Happy path by default: the dashboard is already ready, so the iris
    // opens on schedule. The pulse-specific tests below override this.
    jotaiStore.set(isMinimalMetadataReadyState.atom, true);
    Reflect.deleteProperty(window, 'matchMedia');
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should render nothing when not visible', () => {
    render(<BettyWelcomeOverlay />, { wrapper: Wrapper });

    expect(queryTitleHeading()).not.toBeInTheDocument();
  });

  it('should not render on reload, even though the status is already COMPLETED', () => {
    // The trigger is the session-only atom, not the persisted onboarding status.
    jotaiStore.set(isBettyWelcomeVisibleState.atom, false);

    render(<BettyWelcomeOverlay />, { wrapper: Wrapper });

    expect(queryTitleHeading()).not.toBeInTheDocument();
  });

  it('should render the welcome layer once the status reaches COMPLETED in this session', () => {
    jotaiStore.set(isBettyWelcomeVisibleState.atom, true);

    render(<BettyWelcomeOverlay />, { wrapper: Wrapper });

    expect(queryTitleHeading()).toBeInTheDocument();
    expect(screen.getByText('Welcome, Charles.')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Skip animation' }),
    ).toBeInTheDocument();
  });

  it('should fall back to the nameless greeting when the profile has no first name', () => {
    jotaiStore.set(currentUserState.atom, {
      ...mockedUserData,
      firstName: '',
      onboardingStatus: OnboardingStatus.COMPLETED,
    });
    jotaiStore.set(isBettyWelcomeVisibleState.atom, true);

    render(<BettyWelcomeOverlay />, { wrapper: Wrapper });

    expect(screen.getByText('Welcome.')).toBeInTheDocument();
    expect(screen.queryByText(/Welcome,/)).not.toBeInTheDocument();
  });

  it('should dismiss on skip and move focus to the first interactive dashboard element', async () => {
    const user = userEvent.setup();
    jotaiStore.set(isBettyWelcomeVisibleState.atom, true);

    render(<BettyWelcomeOverlay />, { wrapper: Wrapper });

    await user.click(screen.getByRole('button', { name: 'Skip animation' }));

    expect(queryTitleHeading()).not.toBeInTheDocument();
    expect(screen.getByText('Dashboard action')).toHaveFocus();
  });

  it('should dismiss on Escape and move focus to the first interactive dashboard element', () => {
    jotaiStore.set(isBettyWelcomeVisibleState.atom, true);

    render(<BettyWelcomeOverlay />, { wrapper: Wrapper });

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    expect(queryTitleHeading()).not.toBeInTheDocument();
    expect(screen.getByText('Dashboard action')).toHaveFocus();
  });

  it('should dismiss itself after the full animation duration', () => {
    jest.useFakeTimers();
    jotaiStore.set(isBettyWelcomeVisibleState.atom, true);

    render(<BettyWelcomeOverlay />, { wrapper: Wrapper });

    expect(queryTitleHeading()).toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(BETTY_WELCOME_DURATION_MS);
    });

    expect(queryTitleHeading()).not.toBeInTheDocument();
  });

  it('should play the reduced-motion variant and dismiss after ~2.5s when the user prefers reduced motion', () => {
    mockMatchMedia(true);
    jest.useFakeTimers();
    jotaiStore.set(isBettyWelcomeVisibleState.atom, true);

    render(<BettyWelcomeOverlay />, { wrapper: Wrapper });

    expect(queryTitleHeading()).toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(2500);
    });

    expect(queryTitleHeading()).not.toBeInTheDocument();
  });

  it('should keep the iris closed and wait while the dashboard is not ready yet', () => {
    jest.useFakeTimers();
    jotaiStore.set(isMinimalMetadataReadyState.atom, false);
    jotaiStore.set(isBettyWelcomeVisibleState.atom, true);

    render(<BettyWelcomeOverlay />, { wrapper: Wrapper });

    act(() => {
      jest.advanceTimersByTime(BETTY_WELCOME_IRIS_OPEN_AT_MS);
    });

    expect(queryTitleHeading()).toBeInTheDocument();
    expect(screen.getByTestId('betty-welcome-scene')).not.toHaveClass(
      'is-open',
    );

    act(() => {
      jest.advanceTimersByTime(BETTY_WELCOME_IRIS_PULSE_CAP_MS - 100);
    });

    expect(screen.getByTestId('betty-welcome-scene')).not.toHaveClass(
      'is-open',
    );
  });

  it('should open the iris at the cap when the dashboard never becomes ready', () => {
    jest.useFakeTimers();
    jotaiStore.set(isMinimalMetadataReadyState.atom, false);
    jotaiStore.set(isBettyWelcomeVisibleState.atom, true);

    render(<BettyWelcomeOverlay />, { wrapper: Wrapper });

    act(() => {
      jest.advanceTimersByTime(
        BETTY_WELCOME_IRIS_OPEN_AT_MS + BETTY_WELCOME_IRIS_PULSE_CAP_MS,
      );
    });

    expect(screen.getByTestId('betty-welcome-scene')).toHaveClass('is-open');
    expect(queryTitleHeading()).toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(BETTY_WELCOME_SCENE_DURATIONS_MS.iris);
    });

    expect(queryTitleHeading()).not.toBeInTheDocument();
  });

  it('should open the iris right away when the dashboard is already ready before the dimming ends', () => {
    jest.useFakeTimers();
    jotaiStore.set(isMinimalMetadataReadyState.atom, true);
    jotaiStore.set(isBettyWelcomeVisibleState.atom, true);

    render(<BettyWelcomeOverlay />, { wrapper: Wrapper });

    act(() => {
      jest.advanceTimersByTime(BETTY_WELCOME_IRIS_OPEN_AT_MS);
    });

    expect(screen.getByTestId('betty-welcome-scene')).toHaveClass('is-open');
  });
});
