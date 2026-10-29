// AOS-CRM CRM-005 (R3): the navigation-menu link favicon must honour the
// official ALLOW_REQUESTS_TO_TWENTY_ICONS flag.
//
// Before the CRM-005 fix this component rendered <img src={getLinkFaviconUrl(
// link)}> unconditionally, so every link item in the navigation menu loaded a
// twenty-icons.com favicon whatever the flag said. Unlike the two avatar-based
// consumers, this one puts the provider URL straight into the DOM, so the
// assertions below can read it off the rendered <img>.
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { render } from '@testing-library/react';
import { Provider as JotaiProvider } from 'jotai';

import { allowRequestsToTwentyIconsState } from '@/client-config/states/allowRequestsToTwentyIcons';
import { LinkIconWithLinkOverlay } from '@/navigation-menu-item/display/link/components/LinkIconWithLinkOverlay';
import {
  jotaiStore,
  resetJotaiStore,
} from '@/ui/utilities/state/jotai/jotaiStore';
import { type IconComponent } from 'twenty-ui/icon';
import { ThemeProvider } from 'twenty-ui/theme';

const ICON_PROVIDER_HOST = 'twenty-icons.com';

// Synthetic and NOT empty: getLinkFaviconUrl returns undefined for an empty or
// unparseable link, which would make every case below pass for the wrong
// reason. A different host per case keeps the component's module-level
// failed-favicon cache from leaking between them.
const SYNTHETIC_LINK = {
  off: 'https://enlace-apagado.invalid/ruta',
  on: 'https://enlace-encendido.invalid/ruta',
  initial: 'https://enlace-inicial.invalid/ruta',
};

const LinkOverlayIcon: IconComponent = () => (
  <span data-testid="link-overlay-icon" />
);
const DefaultIcon: IconComponent = () => <span data-testid="default-icon" />;

const renderIcon = (link: string) =>
  render(
    <JotaiProvider store={jotaiStore}>
      <I18nProvider i18n={i18n}>
        <ThemeProvider colorScheme="light">
          <LinkIconWithLinkOverlay
            link={link}
            LinkIcon={LinkOverlayIcon}
            DefaultIcon={DefaultIcon}
          />
        </ThemeProvider>
      </I18nProvider>
    </JotaiProvider>,
  );

const providerImages = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('img'))
    .map((image) => image.getAttribute('src') ?? '')
    .filter((src) => src.includes(ICON_PROVIDER_HOST));

describe('LinkIconWithLinkOverlay favicon requests', () => {
  const fetchSpy = jest.fn();
  const originalFetch = global.fetch;

  beforeEach(() => {
    fetchSpy.mockClear();
    resetJotaiStore();
    global.fetch = fetchSpy as unknown as typeof global.fetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('renders no provider favicon when the official flag is off', () => {
    jotaiStore.set(allowRequestsToTwentyIconsState.atom, false);

    const { container, getByTestId } = renderIcon(SYNTHETIC_LINK.off);

    expect(providerImages(container)).toEqual([]);
    // The local fallback is preserved: the default icon and the link overlay
    // are still rendered.
    expect(getByTestId('default-icon')).toBeInTheDocument();
    expect(getByTestId('link-overlay-icon')).toBeInTheDocument();
  });

  it('does render the synthetic host favicon when the flag is explicitly on, with no request performed', () => {
    jotaiStore.set(allowRequestsToTwentyIconsState.atom, true);

    const { container, queryByTestId } = renderIcon(SYNTHETIC_LINK.on);

    const images = providerImages(container);
    expect(images.length).toBe(1);
    expect(images[0]).toBe(
      `https://${ICON_PROVIDER_HOST}/enlace-encendido.invalid`,
    );
    expect(queryByTestId('default-icon')).not.toBeInTheDocument();
    // jsdom does not load <img> subresources, and nothing else in this render
    // performs a request.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('is fail-closed before client configuration has loaded', () => {
    expect(jotaiStore.get(allowRequestsToTwentyIconsState.atom)).toBe(false);

    const { container, getByTestId } = renderIcon(SYNTHETIC_LINK.initial);

    expect(providerImages(container)).toEqual([]);
    expect(getByTestId('default-icon')).toBeInTheDocument();
  });
});
