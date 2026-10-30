import { BRAND_NAME } from 'twenty-shared/constants';

// `name` is the programmatic identifier a client stores; `title` is what the
// assistant shows a human (MCP 2025-11-25 BaseMetadata). Icons are not here:
// their URL depends on the host the request arrived on, so they are built per
// request by buildMcpServerInfo.
export const MCP_SERVER_INFO = {
  name: 'Betty MCP Server',
  title: BRAND_NAME,
  version: '0.1.0',
};
