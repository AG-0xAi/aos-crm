import { token } from '../token';

import { BETTY_PALETTE } from './betty';

// CRM-019 (R1): the neutral scale IS the brand's neutral ramp. Every surface,
// border and text colour in the product resolves through these twelve steps
// (background.* , border.color.* , font.color.*), so repainting them is what
// makes the app read as Betty instead of only its logo.
//
// The mapping is purpose-first, and it repeats an approved colour wherever the
// scale has more steps than the palette has values -- nothing is interpolated:
//   1  surface            paper-white / charcoal-hover
//   2-3 background        ivory       / charcoal-hover
//   4-5 raised + hairline beige       / charcoal
//   6-8 borders, faint text taupe     / muted-text
//   9-11 secondary text   muted-text  / taupe
//   12 primary text, inverted surface charcoal / ivory
//
// MEASURED (scripts in .aos/reports/CRM-019.md): every text pair is equal or
// better than upstream on the new background. font.color.tertiary, which draws
// the sign-in legal links, goes from 2.85:1 to 5.96:1 and starts passing AA;
// font.color.light stays below AA at 2.31:1, as it was at 2.10:1 before.
//
// The `transparent` family below is unchanged: it is alpha over whatever is
// underneath, so it follows these surfaces without being restated.
export const GRAY_COLOR_TOKENS = {
  scale: {
    gray1: token({
      light: BETTY_PALETTE.paperWhite,
      dark: BETTY_PALETTE.charcoalHover,
    }),
    gray2: token({
      light: BETTY_PALETTE.ivory,
      dark: BETTY_PALETTE.charcoalHover,
    }),
    gray3: token({
      light: BETTY_PALETTE.ivory,
      dark: BETTY_PALETTE.charcoalHover,
    }),
    gray4: token({
      light: BETTY_PALETTE.beige,
      dark: BETTY_PALETTE.charcoal,
    }),
    gray5: token({
      light: BETTY_PALETTE.beige,
      dark: BETTY_PALETTE.charcoal,
    }),
    gray6: token({
      light: BETTY_PALETTE.taupe,
      dark: BETTY_PALETTE.mutedText,
    }),
    gray7: token({
      light: BETTY_PALETTE.taupe,
      dark: BETTY_PALETTE.mutedText,
    }),
    gray8: token({
      light: BETTY_PALETTE.taupe,
      dark: BETTY_PALETTE.mutedText,
    }),
    gray9: token({
      light: BETTY_PALETTE.mutedText,
      dark: BETTY_PALETTE.taupe,
    }),
    gray10: token({
      light: BETTY_PALETTE.mutedText,
      dark: BETTY_PALETTE.taupe,
    }),
    gray11: token({
      light: BETTY_PALETTE.mutedText,
      dark: BETTY_PALETTE.taupe,
    }),
    gray12: token({
      light: BETTY_PALETTE.charcoal,
      dark: BETTY_PALETTE.ivory,
    }),
  },
  transparent: {
    gray1: token({
      light: 'color(display-p3 0 0 0 / 0.02)',
      dark: 'color(display-p3 1 1 1 / 0.031)',
    }),
    gray2: token({
      light: 'color(display-p3 0 0 0 / 0.039)',
      dark: 'color(display-p3 1 1 1 / 0.059)',
    }),
    gray3: token({
      light: 'color(display-p3 0 0 0 / 0.047)',
      dark: 'color(display-p3 1 1 1 / 0.047)',
    }),
    gray4: token({
      light: 'color(display-p3 0 0 0 / 0.071)',
      dark: 'color(display-p3 1 1 1 / 0.071)',
    }),
    gray5: token({
      light: 'color(display-p3 0 0 0 / 0.078)',
      dark: 'color(display-p3 1 1 1 / 0.102)',
    }),
    gray6: token({
      light: 'color(display-p3 0 0 0 / 0.114)',
      dark: 'color(display-p3 1 1 1 / 0.114)',
    }),
    gray7: token({
      light: 'color(display-p3 0 0 0 / 0.161)',
      dark: 'color(display-p3 1 1 1 / 0.141)',
    }),
    gray8: token({
      light: 'color(display-p3 0 0 0 / 0.22)',
      dark: 'color(display-p3 1 1 1 / 0.22)',
    }),
    gray9: token({
      light: 'color(display-p3 0 0 0 / 0.361)',
      dark: 'color(display-p3 1 1 1 / 0.427)',
    }),
    gray10: token({
      light: 'color(display-p3 0 0 0 / 0.478)',
      dark: 'color(display-p3 1 1 1 / 0.478)',
    }),
    gray11: token({
      light: 'color(display-p3 0 0 0 / 0.722)',
      dark: 'color(display-p3 1 1 1 / 0.565)',
    }),
    gray12: token({
      light: 'color(display-p3 0 0 0 / 0.91)',
      dark: 'color(display-p3 1 1 1 / 0.91)',
    }),
  },
};
