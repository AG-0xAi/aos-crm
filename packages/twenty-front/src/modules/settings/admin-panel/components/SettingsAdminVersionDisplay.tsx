import { styled } from '@linaria/react';
import { t } from '@lingui/core/macro';
import { themeCssVariables } from 'twenty-ui/theme';

type SettingsAdminVersionDisplayProps = {
  version: string | undefined | null;
  loading: boolean;
  noVersionMessage: string;
};

const StyledSpan = styled.span`
  color: ${themeCssVariables.font.color.primary};
  font-size: ${themeCssVariables.font.size.sm};
  font-weight: ${themeCssVariables.font.weight.regular};
`;

export const SettingsAdminVersionDisplay = ({
  version,
  loading,
  noVersionMessage,
}: SettingsAdminVersionDisplayProps) => {
  if (loading) {
    return <StyledSpan>{t`Loading...`}</StyledSpan>;
  }

  if (!version) {
    return <StyledSpan>{noVersionMessage}</StyledSpan>;
  }

  return <StyledSpan>{version}</StyledSpan>;
};
