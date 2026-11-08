import { styled } from '@linaria/react';
import { Trans } from '@lingui/react/macro';

import { useWorkspaceBypass } from '@/auth/sign-in-up/hooks/useWorkspaceBypass';
import { useIsCurrentLocationOnAWorkspace } from '@/domain-manager/hooks/useIsCurrentLocationOnAWorkspace';
import { ONBOARDING_CONTENT_BLOCK_WIDTH } from '@/onboarding/constants/OnboardingContentBlockWidth';
import { BRAND_PRIVACY_URL, BRAND_TERMS_URL } from 'twenty-shared/constants';
import { themeCssVariables } from 'twenty-ui/theme';

const StyledCopyContainer = styled.div`
  align-items: center;
  color: ${themeCssVariables.font.color.tertiary};
  font-size: ${themeCssVariables.font.size.sm};
  line-height: 1.4;
  max-width: ${ONBOARDING_CONTENT_BLOCK_WIDTH}px;
  text-align: center;

  & > a {
    color: ${themeCssVariables.font.color.tertiary};
    text-decoration: none;

    &:hover {
      text-decoration: underline;
    }
  }
`;

const StyledLinksContainer = styled.div`
  align-items: center;
  color: ${themeCssVariables.font.color.tertiary};
  display: flex;
  flex-wrap: nowrap;
  font-size: ${themeCssVariables.font.size.sm};
  gap: ${themeCssVariables.spacing[2]};
  justify-content: center;
  max-width: 100%;
  text-align: center;
  white-space: nowrap;

  & > a,
  & > button {
    background: none;
    border: none;
    color: ${themeCssVariables.font.color.tertiary};
    cursor: pointer;
    font: inherit;
    padding: 0;
    text-decoration: none;

    &:hover {
      text-decoration: underline;
    }
  }
`;

const StyledSeparator = styled.span`
  color: ${themeCssVariables.font.color.tertiary};
`;

const StyledFooter = styled.div`
  align-items: center;
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[2]};
  max-width: 100%;
`;

export const FooterNote = () => {
  const { isOnAWorkspace } = useIsCurrentLocationOnAWorkspace();

  const { shouldOfferBypass, shouldUseBypass, enableBypass } =
    useWorkspaceBypass();

  if (!isOnAWorkspace) {
    return (
      <StyledFooter>
        <StyledCopyContainer>
          <Trans>By using Betty, you agree to the</Trans>{' '}
          <a href={BRAND_TERMS_URL} target="_blank" rel="noopener noreferrer">
            <Trans>Terms of Service</Trans>
          </a>{' '}
          <Trans>and</Trans>{' '}
          <a href={BRAND_PRIVACY_URL} target="_blank" rel="noopener noreferrer">
            <Trans>Privacy Policy</Trans>
          </a>
          .
        </StyledCopyContainer>
      </StyledFooter>
    );
  }

  return (
    <StyledFooter>
      <StyledLinksContainer>
        {shouldOfferBypass && !shouldUseBypass && (
          <>
            <button type="button" onClick={enableBypass}>
              <Trans>Bypass SSO</Trans>
            </button>
            <StyledSeparator>•</StyledSeparator>
          </>
        )}
        <a href={BRAND_PRIVACY_URL} target="_blank" rel="noopener noreferrer">
          <Trans>Privacy Policy</Trans>
        </a>
        <StyledSeparator>•</StyledSeparator>
        <a href={BRAND_TERMS_URL} target="_blank" rel="noopener noreferrer">
          <Trans>Terms of Service</Trans>
        </a>
      </StyledLinksContainer>
    </StyledFooter>
  );
};
