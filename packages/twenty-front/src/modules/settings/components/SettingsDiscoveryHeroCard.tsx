import { styled } from '@linaria/react';
import { type ReactNode } from 'react';
import { Card } from 'twenty-ui/primitives/surfaces';
import { useThemeColorScheme, themeCssVariables } from 'twenty-ui/theme';

const DEFAULT_COVER_HEIGHT = 150;

const StyledCoverContainer = styled.div<{ coverHeight: number }>`
  background: ${themeCssVariables.background.secondary};
  box-sizing: border-box;
  height: ${({ coverHeight }) => coverHeight}px;
  overflow: hidden;
  position: relative;
`;

const StyledImage = styled.img`
  display: block;
  height: 100%;
  inset: 0;
  object-fit: cover;
  object-position: center top;
  position: absolute;
  width: 100%;
`;

const StyledFooter = styled.div`
  background: ${themeCssVariables.background.secondary};
  border-top: 1px solid ${themeCssVariables.border.color.medium};
`;

type SettingsDiscoveryHeroCardProps = {
  lightSrc: string;
  darkSrc: string;
  coverHeight?: number;
  footer?: ReactNode;
};

export const SettingsDiscoveryHeroCard = ({
  lightSrc,
  darkSrc,
  coverHeight = DEFAULT_COVER_HEIGHT,
  footer,
}: SettingsDiscoveryHeroCardProps) => {
  const colorScheme = useThemeColorScheme();

  const src = colorScheme === 'light' ? lightSrc : darkSrc;

  return (
    <Card.Root>
      <StyledCoverContainer coverHeight={coverHeight}>
        <StyledImage src={src} alt="" aria-hidden />
      </StyledCoverContainer>
      {footer !== undefined && footer !== null && (
        <StyledFooter>{footer}</StyledFooter>
      )}
    </Card.Root>
  );
};
