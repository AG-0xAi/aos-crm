import { Text } from 'react-email';
import { BRAND_COLORS, BRAND_WORDMARK } from 'twenty-shared/constants';
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

// The wordmark is set in type rather than loaded as an image on purpose: the
// base e-mail has no absolute URL to build an <img src> from (only two of the
// fourteen templates receive serverUrl), and a remote image in an e-mail is
// both a request the recipient never asked for and a read receipt. Georgia is
// the brand manual's own e-mail serif, and the terracotta dot is the
// distinguishing mark. Being text, it needs no alt text.
//
// LEAN-DEBT: the ceiling is typographic fidelity -- the approved asset is
// betty-wordmark-email-2x.png shown at 120px. Upgrade path: thread serverUrl
// through BaseEmail into all fourteen templates and use
// `${serverUrl}/brand/logo/betty-wordmark-email-2x.png`.
export const Logo = () => {
  return (
    <Text style={wordmarkStyle}>
      {BRAND_WORDMARK.replace(/\.$/, '')}
      <span style={dotStyle}>.</span>
    </Text>
  );
};
