import { OnboardingStepAnimatedItem } from '@/onboarding/components/OnboardingStepAnimatedItem';
import { StyledOnboardingStepHeading } from '@/onboarding/components/StyledOnboardingStepHeading';
import { StyledOnboardingStepPage } from '@/onboarding/components/StyledOnboardingStepPage';
import { StyledOnboardingStepSubtitle } from '@/onboarding/components/StyledOnboardingStepSubtitle';
import { StyledOnboardingStepTitle } from '@/onboarding/components/StyledOnboardingStepTitle';
import { ONBOARDING_CONTENT_BLOCK_WIDTH } from '@/onboarding/constants/OnboardingContentBlockWidth';
import { useConnectAssistantStep } from '@/onboarding/hooks/useConnectAssistantStep';
import { McpConnectAssistant } from '@/settings/mcp/components/McpConnectAssistant';
import { styled } from '@linaria/react';
import { useLingui } from '@lingui/react/macro';
import { BRAND_NAME } from 'twenty-shared/constants';
import { Button } from 'twenty-ui/primitives/input';
import { themeCssVariables } from 'twenty-ui/theme';

const StyledContent = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[4]};
  max-width: 100%;
  width: ${ONBOARDING_CONTENT_BLOCK_WIDTH * 2}px;
`;

const StyledFooter = styled.div`
  display: flex;
  justify-content: flex-end;
  max-width: 100%;
  width: ${ONBOARDING_CONTENT_BLOCK_WIDTH * 2}px;
`;

// The route and the file keep their upstream name: this is still the step the
// server reaches through OnboardingStatus.INVITE_TEAM, and the onboarding
// status machine is deliberately untouched. What the step ASKS changed.
export const InviteTeam = () => {
  const { t } = useLingui();
  const { goToCrm, isNavigating } = useConnectAssistantStep();

  return (
    <StyledOnboardingStepPage data-testid="onboarding-connect-assistant-step">
      <StyledOnboardingStepHeading>
        <OnboardingStepAnimatedItem index={0}>
          <StyledOnboardingStepTitle className="betty-serif">
            {t`Connect your assistant`}
          </StyledOnboardingStepTitle>
        </OnboardingStepAnimatedItem>
        <OnboardingStepAnimatedItem index={1}>
          <StyledOnboardingStepSubtitle>
            {t`Ask ${BRAND_NAME} about your contacts and conversations from Claude or ChatGPT. You can also do this later from Settings.`}
          </StyledOnboardingStepSubtitle>
        </OnboardingStepAnimatedItem>
      </StyledOnboardingStepHeading>

      <OnboardingStepAnimatedItem index={2}>
        <StyledContent>
          <McpConnectAssistant />
        </StyledContent>
      </OnboardingStepAnimatedItem>

      <OnboardingStepAnimatedItem index={3}>
        <StyledFooter>
          <Button
            variant="outline"
            onClick={() => void goToCrm()}
            disabled={isNavigating}
          >
            {t`Go to the CRM`}
          </Button>
        </StyledFooter>
      </OnboardingStepAnimatedItem>
    </StyledOnboardingStepPage>
  );
};
