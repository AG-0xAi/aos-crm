// AOS-CRM CRM-005 (R3): the onboarding import preview must honour the official
// ALLOW_REQUESTS_TO_TWENTY_ICONS flag.
//
// Before the CRM-005 fix this preview called getLogoUrlFromDomainName() for
// each of its six hardcoded companies unconditionally, so simply walking
// through onboarding asked twenty-icons.com for figma.com, anthropic.com,
// notion.so, airbnb.com, linkedin.com and slack.com whatever the flag said.
//
// The component takes no props, so the fixture check below is what keeps these
// assertions from passing vacuously: an empty domain would make
// getLogoUrlFromDomainName return undefined on its own. Nothing reaches the
// provider: window.Image is replaced by a recorder.
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { render } from '@testing-library/react';
import { Provider as JotaiProvider } from 'jotai';

import { allowRequestsToTwentyIconsState } from '@/client-config/states/allowRequestsToTwentyIcons';
import { OnboardingImportPreviewCompanies } from '@/onboarding/components/import-contacts/OnboardingImportPreviewCompanies';
import { IMPORT_CONTACTS_PREVIEW_COMPANIES } from '@/onboarding/constants/ImportContactsPreviewCompanies';
import {
  jotaiStore,
  resetJotaiStore,
} from '@/ui/utilities/state/jotai/jotaiStore';
import { ThemeProvider } from 'twenty-ui/theme';

const ICON_PROVIDER_HOST = 'twenty-icons.com';

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

const renderPreview = () =>
  render(
    <JotaiProvider store={jotaiStore}>
      <I18nProvider i18n={i18n}>
        <ThemeProvider colorScheme="light">
          <OnboardingImportPreviewCompanies />
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

describe('OnboardingImportPreviewCompanies icon requests', () => {
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

  it('previews at least one company with a NON-EMPTY domain, so the cases below cannot pass vacuously', () => {
    expect(IMPORT_CONTACTS_PREVIEW_COMPANIES.length).toBeGreaterThan(0);
    expect(
      IMPORT_CONTACTS_PREVIEW_COMPANIES.every(
        (company) => company.domainName.trim().length > 0,
      ),
    ).toBe(true);
  });

  it('requests no company icon from the provider when the official flag is off', () => {
    jotaiStore.set(allowRequestsToTwentyIconsState.atom, false);

    const { container, getByText } = renderPreview();

    expect(urlsNamingTheProvider(container)).toEqual([]);
    // The local fallback is preserved: each row still renders its company.
    for (const company of IMPORT_CONTACTS_PREVIEW_COMPANIES) {
      expect(getByText(company.name)).toBeInTheDocument();
    }
  });

  it('does request every previewed domain when the flag is explicitly on, and the requests are intercepted', () => {
    jotaiStore.set(allowRequestsToTwentyIconsState.atom, true);

    const { container } = renderPreview();

    const requested = urlsNamingTheProvider(container);
    expect(requested.length).toBe(IMPORT_CONTACTS_PREVIEW_COMPANIES.length);
    for (const company of IMPORT_CONTACTS_PREVIEW_COMPANIES) {
      expect(requested.some((url) => url.includes(company.domainName))).toBe(
        true,
      );
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('is fail-closed before client configuration has loaded', () => {
    expect(jotaiStore.get(allowRequestsToTwentyIconsState.atom)).toBe(false);

    const { container } = renderPreview();

    expect(urlsNamingTheProvider(container)).toEqual([]);
  });
});
