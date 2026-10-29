// AOS-CRM CRM-005 (R3): the sign-in background decoration must honour the
// official ALLOW_REQUESTS_TO_TWENTY_ICONS flag.
//
// Before the CRM-005 fix this row called getLogoUrlFromDomainName() for every
// mock company unconditionally, so the UNAUTHENTICATED sign-in screen asked
// twenty-icons.com for six third-party domains whatever the flag said. The
// first and last cases below are that bypass; the middle one is the control
// that keeps them honest.
//
// Nothing here reaches the provider: window.Image (what the avatar primitive
// probes a src with) is replaced by a recorder, so the enabled case observes
// the URL the component WOULD have loaded without a request leaving the
// process. jsdom does not fetch <img> subresources either, but the recorder is
// the guarantee rather than that default.
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { render } from '@testing-library/react';
import { Provider as JotaiProvider } from 'jotai';

import { allowRequestsToTwentyIconsState } from '@/client-config/states/allowRequestsToTwentyIcons';
import { BackgroundMockTableRow } from '@/sign-in-background-mock/components/BackgroundMockTableRow';
import { type BackgroundMockCompany } from '@/sign-in-background-mock/constants/BackgroundMockCompanies';
import {
  jotaiStore,
  resetJotaiStore,
} from '@/ui/utilities/state/jotai/jotaiStore';
import { ThemeProvider } from 'twenty-ui/theme';

const ICON_PROVIDER_HOST = 'twenty-icons.com';

// Synthetic and NOT empty on purpose: an empty domain makes
// getLogoUrlFromDomainName return undefined, and then every assertion below
// would pass without the flag doing anything.
const SYNTHETIC_COMPANY: BackgroundMockCompany = {
  id: 'aos-crm-synthetic-row',
  name: 'Ensayos Sinteticos SL',
  domainName: 'ensayos-sinteticos.invalid',
  createdBy: null,
  accountOwner: null,
  employees: 3,
  address: 'Loopback',
};

const loadedUrls: string[] = [];

class RecordingImage {
  private value = '';
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  decoding = 'auto';
  crossOrigin: string | null = null;
  referrerPolicy = '';
  srcset = '';
  set src(url: string) {
    this.value = url;
    loadedUrls.push(url);
  }
  get src() {
    return this.value;
  }
  addEventListener() {}
  removeEventListener() {}
  removeAttribute() {}
  setAttribute() {}
}

const renderRow = () =>
  render(
    <JotaiProvider store={jotaiStore}>
      <I18nProvider i18n={i18n}>
        <ThemeProvider colorScheme="light">
          <BackgroundMockTableRow company={SYNTHETIC_COMPANY} />
        </ThemeProvider>
      </I18nProvider>
    </JotaiProvider>,
  );

const urlsNamingTheProvider = (container: HTMLElement) =>
  [
    ...loadedUrls,
    ...Array.from(container.querySelectorAll('img')).map(
      (image) => image.getAttribute('src') ?? '',
    ),
  ].filter((url) => url.includes(ICON_PROVIDER_HOST));

describe('BackgroundMockTableRow icon requests', () => {
  const fetchSpy = jest.fn();
  const originalImage = window.Image;
  const originalFetch = global.fetch;

  beforeEach(() => {
    loadedUrls.length = 0;
    fetchSpy.mockClear();
    resetJotaiStore();
    window.Image = RecordingImage as unknown as typeof window.Image;
    global.fetch = fetchSpy as unknown as typeof global.fetch;
  });

  afterAll(() => {
    window.Image = originalImage;
    global.fetch = originalFetch;
  });

  it('requests no company icon from the provider when the official flag is off', () => {
    jotaiStore.set(allowRequestsToTwentyIconsState.atom, false);

    const { container, getByText } = renderRow();

    expect(urlsNamingTheProvider(container)).toEqual([]);
    // The local fallback is preserved: the row still shows the company, with
    // the avatar's own initial instead of a remote logo.
    expect(getByText(SYNTHETIC_COMPANY.name)).toBeInTheDocument();
    expect(getByText(SYNTHETIC_COMPANY.domainName)).toBeInTheDocument();
  });

  it('does request the synthetic domain when the flag is explicitly on, and the request is intercepted', () => {
    jotaiStore.set(allowRequestsToTwentyIconsState.atom, true);

    const { container } = renderRow();

    const requested = urlsNamingTheProvider(container);
    expect(requested.length).toBeGreaterThan(0);
    expect(
      requested.some((url) => url.includes(SYNTHETIC_COMPANY.domainName)),
    ).toBe(true);
    // Recorded, never performed.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('is fail-closed before client configuration has loaded', () => {
    // No set() at all: this is the state the sign-in screen renders with on a
    // cold load, before /client-config answers.
    expect(jotaiStore.get(allowRequestsToTwentyIconsState.atom)).toBe(false);

    const { container } = renderRow();

    expect(urlsNamingTheProvider(container)).toEqual([]);
  });
});
