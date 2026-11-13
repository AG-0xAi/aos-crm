import { styled } from '@linaria/react';
import { useLingui } from '@lingui/react/macro';
import { useEffect, useState } from 'react';
import { type UseFormReturn, useWatch } from 'react-hook-form';

import { SettingsAccountsConnectionForm } from '@/settings/accounts/components/SettingsAccountsConnectionForm';
import { SettingsAccountsPasswordController } from '@/settings/accounts/components/SettingsAccountsPasswordController';
import {
  MAIL_PROVIDER_PRESETS,
  type MailProviderPreset,
} from '@/settings/accounts/constants/MailProviderPresets';
import { OTHER_MAIL_PROVIDER_ID } from '@/settings/accounts/constants/OtherMailProviderId';
import {
  type ConnectionFormData,
  DEFAULT_PROTOCOL_VALUES,
} from '@/settings/accounts/hooks/useImapSmtpCaldavConnectionForm';
import { SettingsTextInput } from '@/ui/input/components/SettingsTextInput';
import { ACCOUNT_TYPES } from 'twenty-shared/constants';
import { Section } from 'twenty-ui/components/layout';
import { Button } from 'twenty-ui/primitives/input';
import { MOBILE_VIEWPORT, themeCssVariables } from 'twenty-ui/theme';

const StyledGrid = styled.div`
  display: grid;
  gap: ${themeCssVariables.spacing[2]};
  grid-template-columns: repeat(3, 1fr);

  @media (max-width: ${MOBILE_VIEWPORT}px) {
    grid-template-columns: repeat(1, 1fr);
  }
`;

const StyledForm = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[4]};
`;

const StyledHelp = styled.p`
  color: ${themeCssVariables.font.color.tertiary};
  font-size: ${themeCssVariables.font.size.sm};
  margin: 0;
`;

const StyledLink = styled.a`
  color: ${themeCssVariables.font.color.primary};
  font-size: ${themeCssVariables.font.size.sm};
`;

const StyledActions = styled.div`
  display: flex;
  gap: ${themeCssVariables.spacing[2]};
`;

type SettingsAccountsNewConnectionFlowProps = {
  formMethods: UseFormReturn<ConnectionFormData>;
};

export const SettingsAccountsNewConnectionFlow = ({
  formMethods,
}: SettingsAccountsNewConnectionFlowProps) => {
  const { t, i18n } = useLingui();
  const { control, setValue, getValues } = formMethods;
  const [preset, setPreset] = useState<MailProviderPreset | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const handle = useWatch({ control, name: 'handle' });
  const password = useWatch({ control, name: 'IMAP.password' });

  const isSimple =
    preset !== null && preset.id !== OTHER_MAIL_PROVIDER_ID && !showAdvanced;

  useEffect(() => {
    if (!isSimple) return;

    for (const protocol of ACCOUNT_TYPES) {
      if (!preset[protocol]) continue;
      setValue(`${protocol}.username`, handle);
      if (protocol !== 'IMAP') setValue(`${protocol}.password`, password);
    }
  }, [isSimple, preset, handle, password, setValue]);

  const selectPreset = (selected: MailProviderPreset) => {
    const { handle: currentHandle, IMAP } = getValues();

    for (const protocol of ACCOUNT_TYPES) {
      const server = selected[protocol];
      setValue(protocol, {
        ...DEFAULT_PROTOCOL_VALUES[protocol],
        ...server,
        password: IMAP?.password ?? '',
        ...(server ? { username: currentHandle } : {}),
      });
    }
    setShowAdvanced(false);
    setPreset(selected);
  };

  if (preset === null) {
    return (
      <Section.Root>
        <Section.Header
          title={t`Mail Account`}
          description={t`Choose your email provider.`}
        />
        <StyledGrid>
          {MAIL_PROVIDER_PRESETS.map((item) => (
            <Button
              key={item.id}
              variant="outline"
              onClick={() => selectPreset(item)}
            >
              {i18n._(item.label)}
            </Button>
          ))}
        </StyledGrid>
      </Section.Root>
    );
  }

  if (!isSimple) {
    return (
      <>
        <Section.Root>
          <StyledActions>
            <Button
              variant="link"
              onClick={() => {
                setShowAdvanced(false);
                setPreset(null);
              }}
            >
              {t`Change provider`}
            </Button>
          </StyledActions>
        </Section.Root>
        <SettingsAccountsConnectionForm control={control} isEditing={false} />
      </>
    );
  }

  return (
    <Section.Root>
      <Section.Header
        title={i18n._(preset.label)}
        description={t`Enter your email and password. We fill in the rest.`}
      />
      <StyledForm>
        <SettingsTextInput
          instanceId="email-address-provider-form"
          label={t`Email Address`}
          placeholder={t`john.doe@example.com`}
          value={handle}
          onChange={(value) => setValue('handle', value)}
        />
        <SettingsAccountsPasswordController
          protocol="IMAP"
          label={t`Password`}
          control={control}
          disabled={false}
          onUnlock={() => {}}
        />
        {preset.helpLine && <StyledHelp>{i18n._(preset.helpLine)}</StyledHelp>}
        {preset.extraNote && (
          <StyledHelp>{i18n._(preset.extraNote)}</StyledHelp>
        )}
        {preset.appPasswordUrl && (
          <StyledLink
            href={preset.appPasswordUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t`Create an app password`}
          </StyledLink>
        )}
        <StyledActions>
          <Button variant="link" onClick={() => setShowAdvanced(true)}>
            {t`Advanced settings`}
          </Button>
          <Button variant="link" onClick={() => setPreset(null)}>
            {t`Change provider`}
          </Button>
        </StyledActions>
      </StyledForm>
    </Section.Root>
  );
};
