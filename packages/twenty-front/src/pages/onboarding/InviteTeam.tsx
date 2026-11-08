import { InviteYourTeamStepContent } from '@/onboarding/components/InviteYourTeamStepContent';
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
import { useState } from 'react';
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
//
// CRM-028: the status enum has no free slot after this one for an optional
// "invite your team" step, so it lives as a sub-view of THIS step's
// completion -- "Continue" moves from connect-assistant to invite-your-team,
// and only sending or skipping there actually calls the server and advances
// onboardingStatus.
export const InviteTeam = () => {
  const { t } = useLingui();
  const [isShowingInviteYourTeam, setIsShowingInviteYourTeam] = useState(false);
  const { completeStep, isNavigating } = useConnectAssistantStep();

  if (isShowingInviteYourTeam) {
    return (
      <StyledOnboardingStepPage data-testid="onboarding-invite-your-team-step">
        <InviteYourTeamStepContent
          isSubmitting={isNavigating}
          onSendInvitations={(emails) => void completeStep(emails)}
          onSkip={() => void completeStep([])}
        />
      </StyledOnboardingStepPage>
    );
  }

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
            {t`Ask Betty about your contacts and conversations from Claude or ChatGPT. You can also do this later from Settings.`}
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
            onClick={() => setIsShowingInviteYourTeam(true)}
            disabled={isNavigating}
          >
            {t`Continue`}
          </Button>
        </StyledFooter>
      </OnboardingStepAnimatedItem>
    </StyledOnboardingStepPage>
  );
};
