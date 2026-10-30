import { ApiPath } from 'twenty-shared/types';

// Points at each host's live OpenAPI, generated per workspace with its custom
// objects. `service-doc` is only populated when the deployment configured a
// help centre (HELP_CENTER_URL): an API catalog that names documentation which
// does not exist is worse than one that names none.
export const buildApiCatalog = (baseUrl: string, docsUrl?: string) => {
  const serviceDoc = docsUrl ? [{ href: docsUrl, type: 'text/html' }] : [];

  return {
    linkset: [
      {
        anchor: `${baseUrl}/${ApiPath.Rest}`,
        'service-desc': [
          {
            href: `${baseUrl}/${ApiPath.Rest}/open-api/core`,
            type: 'application/json',
          },
        ],
        'service-doc': serviceDoc,
        'service-meta': [
          {
            href: `${baseUrl}/${ApiPath.WellKnown}/oauth-protected-resource`,
            type: 'application/json',
          },
        ],
      },
      {
        anchor: `${baseUrl}/${ApiPath.Rest}/metadata`,
        'service-desc': [
          {
            href: `${baseUrl}/${ApiPath.Rest}/open-api/metadata`,
            type: 'application/json',
          },
        ],
        'service-doc': serviceDoc,
      },
      {
        anchor: `${baseUrl}/${ApiPath.GraphQL}`,
        'service-doc': serviceDoc,
      },
      {
        anchor: `${baseUrl}/${ApiPath.Mcp}`,
        'service-desc': [
          {
            href: `${baseUrl}/${ApiPath.WellKnown}/mcp/server-card.json`,
            type: 'application/json',
          },
        ],
        'service-doc': serviceDoc,
      },
    ],
  };
};
