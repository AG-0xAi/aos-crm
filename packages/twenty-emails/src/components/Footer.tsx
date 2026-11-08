import { type JSX } from 'react';
import { Column, Container, Row } from 'react-email';
import { BRAND_DOMAIN, BRAND_NAME } from 'twenty-shared/constants';

import { Link } from 'src/components/Link';
import { ShadowText } from 'src/components/ShadowText';

const footerContainerStyle = {
  marginTop: '12px',
  padding: '0 16px',
};

type FooterProps = {
  reason?: JSX.Element | string;
};

// Only Betty's own site: the upstream footer linked Twenty's website, GitHub
// and two documentation sites (CRM-019 R2). The link text is the domain itself,
// so it needs no separate label. The operator line is deliberately the brand
// and nothing more -- a company name, address or subscription-preferences link
// would be an invention until the founder sets them. `reason` lets a specific
// template say why the recipient got this e-mail, without forcing that line
// onto the other twelve, which have nothing extra true to say.
export const Footer = ({ reason }: FooterProps) => {
  return (
    <Container style={footerContainerStyle}>
      {reason !== undefined ? (
        <Row>
          <Column>
            <ShadowText>{reason}</ShadowText>
          </Column>
        </Row>
      ) : (
        <></>
      )}
      <Row>
        <Column>
          <ShadowText>
            <Link href={`https://${BRAND_DOMAIN}`} value={BRAND_DOMAIN} />
          </ShadowText>
        </Column>
      </Row>
      <ShadowText>{BRAND_NAME}</ShadowText>
    </Container>
  );
};
