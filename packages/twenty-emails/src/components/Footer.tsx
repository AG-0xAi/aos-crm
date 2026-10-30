import { Column, Container, Row } from 'react-email';
import { BRAND_DOMAIN, BRAND_NAME } from 'twenty-shared/constants';

import { Link } from 'src/components/Link';
import { ShadowText } from 'src/components/ShadowText';

const footerContainerStyle = {
  marginTop: '12px',
};

// Only Betty's own site: the upstream footer linked Twenty's website, GitHub
// and two documentation sites (CRM-019 R2). The link text is the domain itself,
// so it needs no separate label. The operator line is deliberately the brand
// and nothing more -- a company name, address or subscription-preferences link
// would be an invention until the founder sets them.
export const Footer = () => {
  return (
    <Container style={footerContainerStyle}>
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
