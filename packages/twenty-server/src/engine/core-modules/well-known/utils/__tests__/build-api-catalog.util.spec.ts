import { buildApiCatalog } from 'src/engine/core-modules/well-known/utils/build-api-catalog.util';

describe('buildApiCatalog', () => {
  const baseUrl = 'https://mycompany.betty.management';
  const docsUrl = 'https://help.betty.management';

  it('anchors each surface at its canonical URL on the given host', () => {
    const catalog = buildApiCatalog(baseUrl, docsUrl);

    const anchors = catalog.linkset.map((entry) => entry.anchor);

    expect(anchors).toEqual([
      `${baseUrl}/rest`,
      `${baseUrl}/rest/metadata`,
      `${baseUrl}/graphql`,
      `${baseUrl}/mcp`,
    ]);
  });

  it('points the REST core surface at its live per-host OpenAPI + OAuth metadata', () => {
    const catalog = buildApiCatalog(baseUrl, docsUrl);

    const restCore = catalog.linkset.find(
      (entry) => entry.anchor === `${baseUrl}/rest`,
    );

    expect(restCore?.['service-desc']).toEqual([
      { href: `${baseUrl}/rest/open-api/core`, type: 'application/json' },
    ]);
    expect(restCore?.['service-meta']).toEqual([
      {
        href: `${baseUrl}/.well-known/oauth-protected-resource`,
        type: 'application/json',
      },
    ]);
  });

  it('references the MCP server card for the MCP surface', () => {
    const catalog = buildApiCatalog(baseUrl, docsUrl);

    const mcp = catalog.linkset.find(
      (entry) => entry.anchor === `${baseUrl}/mcp`,
    );

    expect(mcp?.['service-desc']).toEqual([
      {
        href: `${baseUrl}/.well-known/mcp/server-card.json`,
        type: 'application/json',
      },
    ]);
  });

  it('gives every surface the help centre this deployment configured', () => {
    const catalog = buildApiCatalog(baseUrl, docsUrl);

    for (const entry of catalog.linkset) {
      expect(entry['service-doc']).toEqual([
        { href: docsUrl, type: 'text/html' },
      ]);
    }
  });

  // AOS-CRM CRM-019 (R2): with no help centre configured the catalog advertises
  // no documentation at all, rather than falling back to a third party's docs.
  it('advertises no documentation when no help centre is configured', () => {
    const catalog = buildApiCatalog(baseUrl);

    for (const entry of catalog.linkset) {
      expect(entry['service-doc']).toEqual([]);
    }

    expect(JSON.stringify(catalog)).not.toMatch(/twenty/i);
  });
});
