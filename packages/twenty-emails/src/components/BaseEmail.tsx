import { type JSX } from 'react';
import { I18nProvider } from '@lingui/react';
import { Body, Container, Html } from 'react-email';

import { canvasTheme } from 'src/common-style';
import { BaseHead } from 'src/components/BaseHead';
import { Footer } from 'src/components/Footer';
import { Logo } from 'src/components/Logo';
import { createI18nInstance } from 'src/utils/i18n.utils';
import { type APP_LOCALES } from 'twenty-shared/translations';

const bodyStyle = {
  backgroundColor: canvasTheme.background.page,
  margin: 0,
  fontFamily: canvasTheme.font.family.sans,
};

// react-email's Container already caps at the 37.5em (600px) email standard
// and is 100% fluid below that; a numeric `width` instead sets it as a literal
// HTML width attribute, which clients (Outlook especially) honor over that
// cap. Side padding on the row keeps the card off the viewport edge once it
// goes full-width on small screens.
const fluidContainerStyle = {
  padding: '0 16px',
};

const cardStyle = {
  backgroundColor: canvasTheme.background.card,
  border: `1px solid ${canvasTheme.border.color.card}`,
  borderRadius: canvasTheme.border.radius.md,
  padding: '32px',
};

type BaseEmailProps = {
  children: JSX.Element | JSX.Element[] | string;
  width?: number;
  locale: keyof typeof APP_LOCALES;
  serverUrl?: string;
  footerNote?: JSX.Element | string;
};

export const BaseEmail = ({
  children,
  width,
  locale,
  serverUrl,
  footerNote,
}: BaseEmailProps) => {
  const i18nInstance = createI18nInstance(locale);

  return (
    <I18nProvider i18n={i18nInstance}>
      <Html lang={locale}>
        <BaseHead i18n={i18nInstance} />
        <Body style={bodyStyle}>
          <Container
            width={width ?? '100%'}
            style={width === undefined ? fluidContainerStyle : undefined}
          >
            <Container style={cardStyle}>
              <Logo serverUrl={serverUrl} />
              {children}
            </Container>
            <Footer reason={footerNote} />
          </Container>
        </Body>
      </Html>
    </I18nProvider>
  );
};
