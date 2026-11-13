import { BRAND_ASSET_PATHS, BRAND_NAME } from 'twenty-shared/constants';

import { MCP_SERVER_INFO } from 'src/engine/api/mcp/constants/mcp-server-info.const';
import { buildMcpServerInfo } from 'src/engine/api/mcp/utils/build-mcp-server-info.util';

describe('buildMcpServerInfo', () => {
  it('publishes absolute https icons on the origin the request arrived on, PNGs before the SVG', () => {
    const serverInfo = buildMcpServerInfo('https://api.example.test');

    expect(serverInfo.icons).toEqual([
      {
        src: `https://api.example.test${BRAND_ASSET_PATHS.icon512}`,
        mimeType: 'image/png',
        sizes: ['512x512'],
      },
      {
        src: `https://api.example.test${BRAND_ASSET_PATHS.emailIcon}`,
        mimeType: 'image/png',
        sizes: ['180x180'],
      },
      {
        src: `https://api.example.test${BRAND_ASSET_PATHS.appIcon}`,
        mimeType: 'image/svg+xml',
        sizes: ['any'],
      },
    ]);
  });

  it('follows the host of the request instead of a hostname fixed in the code', () => {
    const firstHost = buildMcpServerInfo('https://one.example.test');
    const secondHost = buildMcpServerInfo('https://two.example.test:8443');

    expect(firstHost.icons?.[0].src).toBe(
      `https://one.example.test${BRAND_ASSET_PATHS.icon512}`,
    );
    expect(secondHost.icons?.[0].src).toBe(
      `https://two.example.test:8443${BRAND_ASSET_PATHS.icon512}`,
    );
  });

  it('names the brand as the title an assistant shows, with the identifier unchanged', () => {
    const serverInfo = buildMcpServerInfo('https://api.example.test');

    expect(serverInfo.title).toBe(BRAND_NAME);
    expect(serverInfo.name).toBe(MCP_SERVER_INFO.name);
    expect(serverInfo.version).toBe(MCP_SERVER_INFO.version);
  });

  // An http icon is refused by assistants as mixed content and an https one on
  // an http-only deployment would not answer: no icon is the honest answer.
  it.each([['http://localhost:3000'], ['not a url'], ['']])(
    'withholds the icons when the origin is %p rather than inventing one',
    (requestBaseUrl) => {
      const serverInfo = buildMcpServerInfo(requestBaseUrl);

      expect(serverInfo.icons).toBeUndefined();
      expect(serverInfo.title).toBe(BRAND_NAME);
    },
  );

  it('never advertises a Twenty-hosted icon', () => {
    const serialized = JSON.stringify(
      buildMcpServerInfo('https://api.example.test'),
    );

    expect(serialized).not.toMatch(/twenty/i);
  });
});
