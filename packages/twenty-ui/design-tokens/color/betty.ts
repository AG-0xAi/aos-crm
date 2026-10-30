// Betty's binding palette, copied verbatim from the brand package's own
// assets/tokens/betty-tokens.css (manual 02 section 3.2). These eight values
// plus the two hovers the token file derives are the ONLY colours the brand
// approves, so nothing here is interpolated or tinted: where the twelve-step
// neutral scale has more steps than the palette has colours, a value repeats
// rather than a new one being invented.
export const BETTY_PALETTE = {
  charcoal: '#35362E',
  taupe: '#BDA58D',
  beige: '#EADDCA',
  terracotta: '#C87452',
  ivory: '#F9F5EC',
  paperWhite: '#FFFDF9',
  terracottaInk: '#96442D',
  mutedText: '#725F50',
  // Derived in the brand token file itself, for the carbon CTA hover and the
  // link/accent hover.
  charcoalHover: '#2A2B24',
  terracottaInkHover: '#7D3824',
} as const;
