import { type I18n } from '@lingui/core';
import { Font, Head } from 'react-email';

import { canvasTheme } from 'src/common-style';
import { doNotTranslate } from 'twenty-shared/i18n';

type BaseHeadProps = {
  i18n: I18n;
};

export const BaseHead = ({ i18n }: BaseHeadProps) => {
  return (
    <Head>
      <title>{i18n._('Betty email')}</title>
      <Font
        fontFamily={doNotTranslate('Arial')}
        fallbackFontFamily="sans-serif"
        fontStyle="normal"
        fontWeight={canvasTheme.font.weight.regular}
      />
    </Head>
  );
};
