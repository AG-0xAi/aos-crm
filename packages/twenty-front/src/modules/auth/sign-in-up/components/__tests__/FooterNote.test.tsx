import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { render, screen } from '@testing-library/react';
import { SOURCE_LOCALE } from 'twenty-shared/translations';

import { FooterNote } from '@/auth/sign-in-up/components/FooterNote';
import { dynamicActivate } from '~/utils/i18n/dynamicActivate';

const mockUseIsCurrentLocationOnAWorkspace = jest.fn();

jest.mock('@/domain-manager/hooks/useIsCurrentLocationOnAWorkspace', () => ({
  useIsCurrentLocationOnAWorkspace: () =>
    mockUseIsCurrentLocationOnAWorkspace(),
}));

jest.mock('@/auth/sign-in-up/hooks/useWorkspaceBypass', () => ({
  useWorkspaceBypass: () => ({
    shouldOfferBypass: false,
    shouldUseBypass: false,
    enableBypass: jest.fn(),
  }),
}));

dynamicActivate(SOURCE_LOCALE);

const renderFooterNote = () =>
  render(
    <I18nProvider i18n={i18n}>
      <FooterNote />
    </I18nProvider>,
  );

describe('FooterNote', () => {
  it('no longer shows the AGPL licence notice on the public sign-in screen', () => {
    mockUseIsCurrentLocationOnAWorkspace.mockReturnValue({
      isOnAWorkspace: false,
    });

    renderFooterNote();

    expect(screen.queryByText(/AGPL-3\.0/)).not.toBeInTheDocument();
    expect(screen.getByText(/Terms of Service/)).toBeInTheDocument();
  });

  it('no longer shows the AGPL licence notice on a workspace sign-in screen', () => {
    mockUseIsCurrentLocationOnAWorkspace.mockReturnValue({
      isOnAWorkspace: true,
    });

    renderFooterNote();

    expect(screen.queryByText(/AGPL-3\.0/)).not.toBeInTheDocument();
    expect(screen.getByText('Privacy Policy')).toBeInTheDocument();
  });
});
