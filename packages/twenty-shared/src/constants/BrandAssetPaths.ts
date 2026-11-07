export const BRAND_ASSET_PATHS = {
  wordmark: '/brand/logo/betty-wordmark-primary.svg',
  wordmarkInverse: '/brand/logo/betty-wordmark-inverse.svg',
  appIcon: '/brand/logo/betty-app-icon.svg',
  monogram: '/brand/logo/betty-monogram.svg',
  favicon: '/brand/logo/betty-favicon.svg',
  icon512: '/brand/logo/icon-512.png',
  // Mail clients do not render SVG, so e-mail uses raster only.
  emailIcon: '/brand/logo/favicon-180.png',
  // Manual 6: one dominant ornament per surface, decorative (alt="").
  threadOrnament: '/brand/ornament/betty-hilo-corto.svg',
} as const;
