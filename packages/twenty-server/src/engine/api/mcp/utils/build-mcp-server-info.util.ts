import { BRAND_ASSET_PATHS } from 'twenty-shared/constants';
import { getUrlSafely, isDefined } from 'twenty-shared/utils';

import { MCP_SERVER_INFO } from 'src/engine/api/mcp/constants/mcp-server-info.const';

// PNGs first: ChatGPT does not render SVG app icons. The SVG stays last for
// clients that prefer a single scalable file.

export type McpServerIcon = {
  src: string;
  mimeType: string;
  sizes: string[];
};

export type McpServerInfo = typeof MCP_SERVER_INFO & {
  icons?: McpServerIcon[];
};

// Without `icons` an assistant draws a generic glyph for the connector
// (modelcontextprotocol.io/specification/2025-11-25/schema -- Implementation
// inherits icons, each an Icon{src, mimeType?, sizes?, theme?}).
//
// `src` is fetched by the CLIENT from its own network, so it has to be
// absolute. It is built from the base URL this very request arrived on: the
// same process also serves /brand from FRONTEND_PATH, so whatever host reaches
// /mcp also answers for the icon, and no hostname is pinned in the code.
// Over plain http (the local profile) the icons are WITHHELD rather than
// published as an http URL assistants may refuse as mixed content, or as an
// https URL this deployment may not answer on.
export const buildMcpServerInfo = (requestBaseUrl: string): McpServerInfo => {
  const baseUrl = getUrlSafely(requestBaseUrl);

  if (!isDefined(baseUrl) || baseUrl.protocol !== 'https:') {
    return MCP_SERVER_INFO;
  }

  return {
    ...MCP_SERVER_INFO,
    icons: [
      {
        src: new URL(BRAND_ASSET_PATHS.icon512, baseUrl).toString(),
        mimeType: 'image/png',
        sizes: ['512x512'],
      },
      {
        src: new URL(BRAND_ASSET_PATHS.emailIcon, baseUrl).toString(),
        mimeType: 'image/png',
        sizes: ['180x180'],
      },
      {
        src: new URL(BRAND_ASSET_PATHS.appIcon, baseUrl).toString(),
        mimeType: 'image/svg+xml',
        sizes: ['any'],
      },
    ],
  };
};
