import { Img, Text } from 'react-email';
import {
  BRAND_COLORS,
  BRAND_NAME,
  BRAND_WORDMARK,
} from 'twenty-shared/constants';
import { doNotTranslate } from 'twenty-shared/i18n';

const wordmarkStyle = {
  color: BRAND_COLORS.charcoal,
  fontFamily: doNotTranslate('Georgia, "Times New Roman", serif'),
  fontSize: '28px',
  fontWeight: 400,
  letterSpacing: '-0.02em',
  lineHeight: '32px',
  margin: doNotTranslate('0 0 40px 0'),
};

const dotStyle = {
  color: BRAND_COLORS.terracotta,
};

const logoImageStyle = {
  margin: doNotTranslate('0 0 32px 0'),
};

type LogoProps = {
  serverUrl?: string;
};

// The approved asset, betty-wordmark-email-2x.png, needs an absolute URL --
// only templates that receive serverUrl can build one. The typeset fallback
// below stays for the rest: Georgia is the brand manual's own e-mail serif,
// and the terracotta dot is the distinguishing mark. Being text, it needs no
// alt text.
//
// LEAN-DEBT: the ceiling is every template on the real asset. Upgrade path:
// thread serverUrl through BaseEmail into the remaining twelve templates.
export const Logo = ({ serverUrl }: LogoProps) => {
  if (serverUrl !== undefined) {
    return (
      <Img
        src={`${serverUrl}/brand/logo/betty-wordmark-email-2x.png`}
        width={120}
        height={59}
        alt={BRAND_NAME}
        style={logoImageStyle}
      />
    );
  }

  return (
    <Text style={wordmarkStyle}>
      {BRAND_WORDMARK.replace(/\.$/, '')}
      <span style={dotStyle}>.</span>
    </Text>
  );
};
