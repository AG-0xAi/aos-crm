import { BRAND_ASSET_PATHS } from 'twenty-shared/constants';

// Served from this deployment's own public/brand, never from a Twenty-hosted
// placeholder host (CRM-019 R2). A workspace with no logo of its own shows
// Betty's app icon.
export const DEFAULT_WORKSPACE_LOGO = BRAND_ASSET_PATHS.appIcon;
