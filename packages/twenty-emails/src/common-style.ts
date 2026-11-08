import { BRAND_COLORS } from 'twenty-shared/constants';
import { doNotTranslate } from 'twenty-shared/i18n';

// Betty's email palette and type, brand manual 3.2: Georgia (serif) for
// headings, a web-safe sans for body copy -- email clients cannot load the
// brand's own webfonts.
export const canvasTheme = {
  font: {
    colors: {
      highlighted: BRAND_COLORS.charcoal,
      primary: BRAND_COLORS.mutedText,
      tertiary: BRAND_COLORS.mutedText,
      inverted: BRAND_COLORS.paperWhite,
      link: BRAND_COLORS.terracottaInk,
    },
    family: {
      serif: doNotTranslate('Georgia, "Times New Roman", serif'),
      sans: doNotTranslate('Arial, Helvetica, sans-serif'),
    },
    weight: {
      regular: 400,
      bold: 700,
    },
    size: {
      sm: '12px',
      md: '13px',
      lg: '16px',
      xl: '24px',
    },
    lineHeight: '20px',
  },
  border: {
    radius: { sm: '4px', md: '8px' },
    // The card's own hairline is beige; a box highlighted *inside* the card
    // needs a darker line of its own, or it would share its border with its
    // own background.
    color: { card: BRAND_COLORS.beige, highlighted: BRAND_COLORS.taupe },
  },
  background: {
    page: BRAND_COLORS.ivory,
    card: BRAND_COLORS.paperWhite,
    colors: { highlight: BRAND_COLORS.beige },
    button: BRAND_COLORS.charcoal,
  },
};
