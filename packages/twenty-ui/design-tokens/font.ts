import { COLOR_TOKENS } from './color';
import { GRAY_SCALE_TOKENS } from './grayScale';
import { token } from './token';
export const FONT_TOKENS = {
  color: {
    primary: GRAY_SCALE_TOKENS.gray12,
    secondary: GRAY_SCALE_TOKENS.gray11,
    tertiary: GRAY_SCALE_TOKENS.gray9,
    light: GRAY_SCALE_TOKENS.gray8,
    extraLight: GRAY_SCALE_TOKENS.gray7,
    inverted: GRAY_SCALE_TOKENS.gray1,
    onAccent: token('color(display-p3 1 1 1)'),
    danger: COLOR_TOKENS.red,
  },
  size: {
    xxs: token('0.625rem'),
    xs: token('0.85rem'),
    sm: token('0.92rem'),
    md: token('1rem'),
    lg: token('1.23rem'),
    xl: token('1.54rem'),
    xxl: token('1.85rem'),
  },
  weight: {
    regular: token('400', { unit: 'number' }),
    medium: token('500', { unit: 'number' }),
    semiBold: token('600', { unit: 'number' }),
  },
  // CRM-019 (R1): the brand's two OFL families (manual 02 section 3.3), both
  // self-hosted from twenty-front/public/brand/fonts with their licences next
  // to them. Upstream named Inter here but shipped no @font-face, so Inter was
  // only ever used where the reader happened to have it installed; the faces
  // are declared in twenty-front/src/index.css.
  family: token("'Source Sans 3', system-ui, Arial, sans-serif"),
  // Fraunces, for the few places the brand speaks in display type. Always used
  // through the `.betty-serif` class, which also pins SOFT 0 / WONK 0: the
  // manual forbids Fraunces' wonky terminals and the variable font defaults to
  // WONK 1.
  familyDisplay: token("'Fraunces', Georgia, serif"),
};
