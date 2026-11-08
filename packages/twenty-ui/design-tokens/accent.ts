import { BETTY_PALETTE } from './color/betty';
import { token } from './token';

// CRM-019 (R1): the accent family is the brand colour -- primary buttons,
// links, selection and focus all resolve through it. Upstream pointed it at the
// twelve-step blue; it now points at the brand's terracotta pair and, for the
// two faint steps the scale uses as accent SURFACES, at beige and taupe.
// Nothing is tinted: the manual's eight colours are the only ones used.
//
// terracotta-ink (#96442D) carries text, links and the accent CTA at 6.10:1 on
// ivory. Plain terracotta (#C87452) is 3.18:1 and the manual forbids it for
// normal text, so it appears only where this scale is read as a graphic or an
// icon (accent3570/accent4060, accent7/accent8) and as the on-dark accent.
const ACCENT_SURFACE = token({
  light: BETTY_PALETTE.beige,
  dark: BETTY_PALETTE.charcoal,
});
const ACCENT_LINE = token({
  light: BETTY_PALETTE.taupe,
  dark: BETTY_PALETTE.mutedText,
});
const ACCENT_GRAPHIC = token({
  light: BETTY_PALETTE.terracotta,
  dark: BETTY_PALETTE.terracotta,
});
const ACCENT_INK = token({
  light: BETTY_PALETTE.terracottaInk,
  dark: BETTY_PALETTE.terracotta,
});

export const ACCENT_TOKENS = {
  primary: ACCENT_INK,
  secondary: ACCENT_INK,
  tertiary: ACCENT_LINE,
  quaternary: ACCENT_SURFACE,
  accent3570: ACCENT_GRAPHIC,
  accent4060: ACCENT_GRAPHIC,
  accent1: ACCENT_SURFACE,
  accent2: ACCENT_SURFACE,
  accent3: ACCENT_LINE,
  accent4: ACCENT_LINE,
  accent5: ACCENT_INK,
  accent6: ACCENT_INK,
  accent7: ACCENT_GRAPHIC,
  accent8: ACCENT_GRAPHIC,
  accent9: ACCENT_INK,
  accent10: ACCENT_INK,
  accent11: ACCENT_INK,
  accent12: ACCENT_INK,
};
