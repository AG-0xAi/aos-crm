// Betty's binding palette, copied verbatim from the brand package's own
// assets/tokens/betty-tokens.css (manual 02 section 3.2). These eight values
// plus the two hovers the token file derives were the only colours the brand
// approved, so nothing here was interpolated or tinted: where the twelve-step
// neutral scale had more steps than the palette had colours, a value repeated
// rather than a new one being invented. The coordinator added `tertiaryText`
// and `tertiaryTextDark` on 08/11/2026, by the founder's delegation
// (CRM-021, «Decision (2026-11-08): tertiary text tone»), because the brand
// package had no tertiary text tone and `font.color.tertiary` was repeating
// `mutedText`.
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
  // CRM-021: the tertiary text tone, defined by the coordinator on
  // 08/11/2026 since the brand package carried none.
  tertiaryText: '#816d5c',
  tertiaryTextDark: '#a6907b',
} as const;
