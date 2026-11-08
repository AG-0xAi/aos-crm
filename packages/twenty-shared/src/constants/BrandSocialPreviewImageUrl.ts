// The social preview card is fetched by crawlers from their own network, so it
// cannot be a path relative to a deployment they are not looking at. This is
// the same approved icon this repo ships under BRAND_ASSET_PATHS.icon512
// (identical SHA-256), served by the brand's own site.
export const BRAND_SOCIAL_PREVIEW_IMAGE_URL =
  'https://betty.management/assets/logo/icon-512.png';
