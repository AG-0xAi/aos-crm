import { onboardingConfigState } from '@/client-config/states/onboardingConfigState';
import { OnboardingRewardMainButton } from '@/onboarding/components/OnboardingRewardMainButton';
import { OnboardingSkipButton } from '@/onboarding/components/OnboardingSkipButton';
import { OnboardingStepAnimatedItem } from '@/onboarding/components/OnboardingStepAnimatedItem';
import { StyledOnboardingStepHeading } from '@/onboarding/components/StyledOnboardingStepHeading';
import { StyledOnboardingStepSubtitle } from '@/onboarding/components/StyledOnboardingStepSubtitle';
import { StyledOnboardingStepTitle } from '@/onboarding/components/StyledOnboardingStepTitle';
import { ONBOARDING_CONTENT_BLOCK_WIDTH } from '@/onboarding/constants/OnboardingContentBlockWidth';
import { onboardingInviteTeamEmailsDraftState } from '@/onboarding/states/onboardingInviteTeamEmailsDraftState';
import { onboardingCreditsProgressSelector } from '@/onboarding/states/selectors/onboardingCreditsProgressSelector';
import { SettingsTextInput } from '@/ui/input/components/SettingsTextInput';
import { useAtomStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomStateValue';
import { useSetAtomState } from '@/ui/utilities/state/jotai/hooks/useSetAtomState';
import { sanitizeEmailList } from '@/workspace/utils/sanitizeEmailList';
import { zodResolver } from '@hookform/resolvers/zod';
import { styled } from '@linaria/react';
import { i18n } from '@lingui/core';
import { msg, t } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import { Controller, useForm } from 'react-hook-form';
import { doNotTranslate } from 'twenty-shared/i18n';
import { isDefined } from 'twenty-shared/utils';
import { themeCssVariables } from 'twenty-ui/theme';
import { z } from 'zod';

const StyledContent = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[4]};
  max-width: 100%;
  width: ${ONBOARDING_CONTENT_BLOCK_WIDTH * 2}px;
`;

const StyledFooter = styled.div`
  align-items: flex-end;
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[3]};
  max-width: 100%;
  width: ${ONBOARDING_CONTENT_BLOCK_WIDTH * 2}px;
`;

const emailsEmptyErrorMessage = msg`Emails should not be empty`;

// The same shape WorkspaceInviteTeam validates on the Settings side: a
// comma-separated list, sanitized and checked email by email. maxEmails adds
// the onboarding-only ceiling (onboardingConfig.inviteTeamMaxInvites), which
// Settings has no reason to cap.
const getValidationSchema = (maxEmails: number | undefined) =>
  z.object({
    emails: z.string().superRefine((value, ctx) => {
      if (!value.length) {
        return;
      }

      const emails = sanitizeEmailList(value.split(','));

      if (emails.length === 0) {
        ctx.addIssue({
          code: 'custom',
          message: i18n._(emailsEmptyErrorMessage),
        });
        return;
      }

      const invalidEmails = emails.filter(
        (email) => !z.email().safeParse(email).success,
      );

      if (invalidEmails.length > 0) {
        const invalidEmailsList = invalidEmails.join(', ');
        ctx.addIssue({
          code: 'custom',
          message:
            invalidEmails.length > 1
              ? t`Invalid emails: ${invalidEmailsList}`
              : t`Invalid email: ${invalidEmailsList}`,
        });
        return;
      }

      if (isDefined(maxEmails) && emails.length > maxEmails) {
        ctx.addIssue({
          code: 'custom',
          message: t`You can invite up to ${maxEmails} teammates at a time`,
        });
      }
    }),
  });

type InviteYourTeamFormInput = { emails: string };

type InviteYourTeamStepContentProps = {
  isSubmitting: boolean;
  onSendInvitations: (emails: string[]) => void;
  onSkip: () => void;
};

export const InviteYourTeamStepContent = ({
  isSubmitting,
  onSendInvitations,
  onSkip,
}: InviteYourTeamStepContentProps) => {
  const { t } = useLingui();
  const onboardingConfig = useAtomStateValue(onboardingConfigState);
  const { inviteTeamButtonReward } = useAtomStateValue(
    onboardingCreditsProgressSelector,
  );
  const setOnboardingInviteTeamEmailsDraft = useSetAtomState(
    onboardingInviteTeamEmailsDraftState,
  );

  const { handleSubmit, control, formState, watch } =
    useForm<InviteYourTeamFormInput>({
      mode: 'onSubmit',
      resolver: zodResolver(
        getValidationSchema(onboardingConfig?.inviteTeamMaxInvites),
      ),
      defaultValues: { emails: '' },
    });
  const isEmailsEmpty = !watch('emails');

  const submit = handleSubmit(({ emails }) => {
    onSendInvitations(sanitizeEmailList(emails.split(',')));
  });

  return (
    <>
      <StyledOnboardingStepHeading>
        <OnboardingStepAnimatedItem index={0}>
          <StyledOnboardingStepTitle className="betty-serif">
            {t`Invite your team`}
          </StyledOnboardingStepTitle>
        </OnboardingStepAnimatedItem>
        <OnboardingStepAnimatedItem index={1}>
          <StyledOnboardingStepSubtitle>
            {t`Get the most out of Betty by inviting your team. You can also do this later from Settings.`}
          </StyledOnboardingStepSubtitle>
        </OnboardingStepAnimatedItem>
      </StyledOnboardingStepHeading>

      <OnboardingStepAnimatedItem index={2}>
        <StyledContent>
          <form onSubmit={submit}>
            <Controller
              name="emails"
              control={control}
              render={({
                field: { value, onChange },
                fieldState: { error },
              }) => (
                <SettingsTextInput
                  instanceId="onboarding-invite-team-emails"
                  placeholder={doNotTranslate(
                    'tim@apple.com, jony.ive@apple.dev',
                  )}
                  value={value}
                  onChange={(nextValue) => {
                    onChange(nextValue);
                    setOnboardingInviteTeamEmailsDraft(nextValue.split(','));
                  }}
                  error={error?.message}
                  fullWidth
                  autoFocusOnMount
                />
              )}
            />
          </form>
        </StyledContent>
      </OnboardingStepAnimatedItem>

      <OnboardingStepAnimatedItem index={3}>
        <StyledFooter>
          <OnboardingRewardMainButton
            label={t`Send invitations`}
            creditsReward={inviteTeamButtonReward.creditsReward}
            isRewardPerItem={inviteTeamButtonReward.isRewardPerItem}
            disabled={isEmailsEmpty || !!formState.errors.emails}
            isLoading={isSubmitting}
            onClick={() => void submit()}
          />
          <OnboardingSkipButton onClick={onSkip} disabled={isSubmitting} />
        </StyledFooter>
      </OnboardingStepAnimatedItem>
    </>
  );
};
