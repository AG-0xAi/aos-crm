import { type JSX } from 'react';
import { Link as EmailLink } from 'react-email';

import { canvasTheme } from 'src/common-style';

const linkStyle = {
  textDecoration: 'underline',
  fontFamily: canvasTheme.font.family.sans,
};

type LinkProps = {
  value: JSX.Element | JSX.Element[] | string;
  href: string;
  color?: string;
};

export const Link = ({ value, href, color }: LinkProps) => {
  return (
    <EmailLink
      href={href}
      style={{
        ...linkStyle,
        color: color ?? canvasTheme.font.colors.link,
      }}
    >
      {value}
    </EmailLink>
  );
};
