// Betty's binding palette, copied verbatim from the brand package's own
// assets/tokens/betty-tokens.css (manual 02 section 3.2). These eight values
// plus the two hovers the token file derives are the ONLY colours the brand
// approves, so nothing here is interpolated or tinted: where the twelve-step
// neutral scale has more steps than the palette has colours, a value repeats
// rather than a new one being invented.
export const BETTY_PALETTE = {
  charcoal: '#35362e',
  taupe: '#bda58d',
  beige: '#eaddca',
  terracotta: '#c87452',
  ivory: '#f9f5ec',
  paperWhite: '#fffdf9',
  terracottaInk: '#96442d',
  mutedText: '#725f50',
  // Derived in the brand token file itself, for the carbon CTA hover and the
  // link/accent hover.
  charcoalHover: '#2a2b24',
  terracottaInkHover: '#7d3824',
} as const;
