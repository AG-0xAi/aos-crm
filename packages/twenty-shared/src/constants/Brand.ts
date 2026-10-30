// The one place the product's own name, wordmark, domain and legal URLs are
// written. Front, server and e-mail templates all read these, so the brand
// guard (scripts/aos/verify-brand.mjs) has a single file to anchor on.
export const BRAND_NAME = 'Betty';
export const BRAND_WORDMARK = 'betty.';
export const BRAND_DOMAIN = 'betty.management';
export const BRAND_DESCRIPTOR = 'Asistente inteligente de relaciones comerciales';

export const BRAND_TERMS_URL = 'https://betty.management/terminos';
export const BRAND_PRIVACY_URL = 'https://betty.management/privacidad';

export const BRAND_ASSET_PATHS = {
  wordmark: '/brand/logo/betty-wordmark-primary.svg',
  wordmarkInverse: '/brand/logo/betty-wordmark-inverse.svg',
  appIcon: '/brand/logo/betty-app-icon.svg',
  favicon: '/brand/logo/betty-favicon.svg',
  icon512: '/brand/logo/icon-512.png',
  // Mail clients do not render SVG, so e-mail uses raster only.
  emailIcon: '/brand/logo/favicon-180.png',
} as const;

// Brand manual 3.2. Only values needed outside the front's theme tokens live
// here: e-mail HTML cannot read CSS custom properties.
export const BRAND_COLORS = {
  charcoal: '#35362E',
  terracotta: '#C87452',
  terracottaInk: '#96442D',
  ivory: '#F9F5EC',
  paperWhite: '#FFFDF9',
  mutedText: '#725F50',
  beige: '#EADDCA',
  taupe: '#BDA58D',
} as const;

// AGPL section 13: a user interacting with the deployed build must be offered
// the source of THAT build. SOURCE_CODE_URL (client config) names it; this is
// the fallback repository when the deployment has not pinned a commit.
export const BRAND_LICENSE_NAME = 'AGPL-3.0';
export const BRAND_SOURCE_CODE_URL = 'https://github.com/AG-0xAi/aos-crm';
