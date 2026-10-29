#!/usr/bin/env node
// CRM-007 R1: drives the whole OAuth path an MCP client takes against the
// local stack, with no browser and no external account.
//
// The /authorize page is a frontend route: the SPA signs the user in and then
// posts the `authorizeApp` GraphQL mutation that mints the authorization code.
// This probe makes exactly those calls -- read out of
// auth.resolver.ts (authorizeApp) and
// application-oauth/controllers/{oauth-registration,oauth-token}.controller.ts
// -- so the measurement is of the real server, not of a double. It is a probe,
// not a gate command: it registers an OAuth client row in the local workspace
// on every run.
//
//   node scripts/aos/mcp/oauth-pkce-probe.mjs
//
// Credentials: the local administrator's are read from the ignored
// deploy/local/.env and never printed. The tokens this mints are revoked at
// the end and nothing is written to the repo.
import {
  ADMIN_EMAIL, ADMIN_PASSWORD, BASE_URL, SERVER_URL,
  graphql, http, httpAbsolute, mcpCall, oneShotRedirectListener, pkcePair,
} from './lib.mjs';

// auth.resolver.ts is a @MetadataResolver, so authorizeApp and the sign-in
// mutations all live on /metadata. Posting them to /graphql comes back as
// "Cannot query field ... on type Mutation" (measured 2026-10-29), which reads
// like a missing feature and is really the wrong schema.
const METADATA = '/metadata';
const steps = [];

function record(name, ok, detail) {
  steps.push({ name, ok, detail });
  console.log(`${ok ? '[PASS]' : '[FAIL]'} ${name}${detail ? ` -- ${detail}` : ''}`);
  return ok;
}

// A measured fact that is neither a pass nor a failure: real behaviour this
// deployment has to live with and document.
function note(detail) {
  console.log(`[LIMIT] ${detail}`);
}

function die(message) {
  console.error(`[FAIL] ${message}`);
  process.exit(1);
}

function gqlErrors(body) {
  return (body.errors || []).map((e) => e.message).join(' | ');
}

async function loginAsAdmin() {
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    die('deploy/local/.env carries no AOS_CRM_ADMIN_EMAIL/AOS_CRM_ADMIN_PASSWORD; run the runtime e2e suite once to create the first administrator');
  }
  const login = await graphql(
    METADATA,
    'mutation($email: String!, $password: String!, $origin: String!) {' +
      ' getLoginTokenFromCredentials(email: $email, password: $password, origin: $origin) { loginToken { token } } }',
    { email: ADMIN_EMAIL, password: ADMIN_PASSWORD, origin: SERVER_URL },
  );
  if (login.errors) die(`administrator sign-in failed: ${gqlErrors(login)}`);
  const exchanged = await graphql(
    METADATA,
    'mutation($loginToken: String!, $origin: String!) {' +
      ' getAuthTokensFromLoginToken(loginToken: $loginToken, origin: $origin) { tokens { accessOrWorkspaceAgnosticToken { token } } } }',
    { loginToken: login.data.getLoginTokenFromCredentials.loginToken.token, origin: SERVER_URL },
  );
  if (exchanged.errors) die(`login-token exchange failed: ${gqlErrors(exchanged)}`);
  return exchanged.data.getAuthTokensFromLoginToken.tokens.accessOrWorkspaceAgnosticToken.token;
}

async function main() {
  console.log(`[INFO] target ${BASE_URL} (effective SERVER_URL ${SERVER_URL})`);

  // 1. Discovery, as an MCP client reads it: the 401 names the protected
  //    resource document, which names the authorization server.
  const unauthenticated = await mcpCall('tools/list');
  const challenge = unauthenticated.headers?.['www-authenticate'] ?? '';
  const metadataUrl = /resource_metadata="([^"]+)"/.exec(challenge)?.[1];
  record(
    '/mcp without a credential answers 401 and points at its resource metadata',
    unauthenticated.status === 401 && Boolean(metadataUrl),
    `status ${unauthenticated.status}, resource_metadata ${metadataUrl ?? 'absent'}`,
  );
  if (!metadataUrl) die('no resource_metadata pointer to follow');

  const protectedResource = await http(new URL(metadataUrl).pathname);
  const resourceDoc = protectedResource.status === 200 ? JSON.parse(protectedResource.body) : {};
  const authServer = resourceDoc.authorization_servers?.[0];
  record(
    'the protected resource document names this deployment as its authorization server',
    protectedResource.status === 200 && authServer === SERVER_URL && resourceDoc.resource === `${SERVER_URL}/mcp`,
    `resource ${resourceDoc.resource}, authorization_servers ${JSON.stringify(resourceDoc.authorization_servers)}`,
  );

  const asDoc = JSON.parse((await http('/.well-known/oauth-authorization-server')).body);
  record(
    'the authorization server document publishes dynamic registration and PKCE S256',
    asDoc.issuer === SERVER_URL &&
      typeof asDoc.registration_endpoint === 'string' &&
      asDoc.code_challenge_methods_supported?.includes('S256') &&
      asDoc.grant_types_supported?.includes('authorization_code'),
    `issuer ${asDoc.issuer}, registration ${asDoc.registration_endpoint}, pkce ${JSON.stringify(asDoc.code_challenge_methods_supported)}`,
  );

  // 2. Dynamic client registration against a loopback redirect of our own.
  const listener = oneShotRedirectListener();
  await listener.ready;
  const redirectUri = listener.redirectUri;
  const registration = await http('/oauth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: 'AOS-CRM CRM-007 local probe',
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }),
  });
  const client = registration.status === 201 ? JSON.parse(registration.body) : {};
  record(
    'a client registers dynamically with a loopback redirect URI',
    registration.status === 201 && typeof client.client_id === 'string',
    `status ${registration.status}, redirect ${redirectUri}, auth method ${client.token_endpoint_auth_method}`,
  );
  if (!client.client_id) {
    await listener.close();
    die(`dynamic registration failed: ${registration.body.slice(0, 300)}`);
  }

  // 3. Authorization code + PKCE as the local administrator. This is the step
  //    a browser would drive; the two calls below are what the /authorize page
  //    itself makes.
  const adminToken = await loginAsAdmin();
  const pkce = pkcePair();
  const state = `aos-crm-${Date.now()}`;
  const authorize = await graphql(
    METADATA,
    'mutation($clientId: String!, $codeChallenge: String!, $redirectUrl: String!, $state: String!, $scope: String!) {' +
      ' authorizeApp(clientId: $clientId, codeChallenge: $codeChallenge, redirectUrl: $redirectUrl, state: $state, scope: $scope) { redirectUrl } }',
    {
      clientId: client.client_id,
      codeChallenge: pkce.challenge,
      redirectUrl: redirectUri,
      state,
      scope: 'api profile',
    },
    adminToken,
  );
  if (authorize.errors) {
    await listener.close();
    die(`authorizeApp failed: ${gqlErrors(authorize)}`);
  }
  const redirect = new URL(authorize.data.authorizeApp.redirectUrl);
  // Follow the redirect for real, to the client's own loopback port: the
  // listener a client registers is what has to receive the code, not a string
  // we parsed out of the response ourselves.
  await httpAbsolute(redirect.toString()).catch(() => {});
  const delivered = await Promise.race([
    listener.hit,
    new Promise((r) => setTimeout(() => r(null), 15_000)),
  ]);
  await listener.close();
  const code = delivered?.get('code') ?? redirect.searchParams.get('code');
  record(
    'the authorization step redirects an authorization code and the state back to the loopback listener',
    Boolean(code) && delivered?.get('state') === state,
    `code ${code ? 'present' : 'absent'}, state echoed ${delivered?.get('state') === state}`,
  );
  if (!code) die('no authorization code was issued');

  // 4. Token exchange, with and without the right verifier.
  const wrongVerifier = await http('/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      client_id: client.client_id,
      redirect_uri: redirectUri,
      code_verifier: pkcePair().verifier,
    }),
  });
  record(
    'the token endpoint refuses the code when the PKCE verifier does not match the challenge',
    wrongVerifier.status >= 400,
    `status ${wrongVerifier.status}, error ${JSON.parse(wrongVerifier.body).error ?? 'none'}`,
  );

  const exchange = await http('/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      client_id: client.client_id,
      redirect_uri: redirectUri,
      code_verifier: pkce.verifier,
    }),
  });
  const tokens = exchange.status === 200 ? JSON.parse(exchange.body) : {};
  record(
    'the same code plus the matching verifier is exchanged for an access token',
    exchange.status === 200 && typeof tokens.access_token === 'string' && typeof tokens.refresh_token === 'string',
    `status ${exchange.status}, token_type ${tokens.token_type}, expires_in ${tokens.expires_in}, scope ${tokens.scope}, refresh token ${tokens.refresh_token ? 'issued' : 'absent'}`,
  );
  if (!tokens.access_token) die(`token exchange failed: ${exchange.body.slice(0, 300)}`);

  const replay = await http('/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      client_id: client.client_id,
      redirect_uri: redirectUri,
      code_verifier: pkce.verifier,
    }),
  });
  record(
    'the authorization code cannot be replayed a second time',
    replay.status >= 400,
    `status ${replay.status}, error ${JSON.parse(replay.body).error ?? 'none'}`,
  );

  // 5. The issued token works on /mcp.
  const initialize = await mcpCall(
    'initialize',
    { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'aos-crm-oauth-probe', version: '1' } },
    { token: tokens.access_token },
  );
  record(
    'the OAuth access token initializes an MCP session',
    initialize.status === 200 && Boolean(initialize.result?.serverInfo?.name),
    `status ${initialize.status}, server ${initialize.result?.serverInfo?.name} ${initialize.result?.protocolVersion}`,
  );
  const listed = await mcpCall('tools/list', {}, { token: tokens.access_token });
  const names = (listed.result?.tools ?? []).map((t) => t.name);
  record(
    'the OAuth access token lists tools',
    listed.status === 200 && names.length > 0,
    `status ${listed.status}, ${names.length} tools: ${names.join(', ')}`,
  );
  record(
    'search_help_center is absent from the tool list that OAuth token sees',
    !names.includes('search_help_center'),
    `tools: ${names.join(', ')}`,
  );

  // 6. Revocation. RFC 7009 makes /oauth/revoke answer 200 for a valid and an
  //    invalid token alike, so the 200 proves nothing; what the authorization
  //    is worth afterwards is measured by trying to use it.
  const revoke = await http('/oauth/revoke', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: tokens.refresh_token, client_id: client.client_id }),
  });
  const refreshAfterRevoke = await http('/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
      client_id: client.client_id,
    }),
  });
  record(
    'revoking the refresh token kills the authorization: no further access token can be minted',
    revoke.status === 200 && refreshAfterRevoke.status >= 400,
    `revoke status ${revoke.status}, refresh grant afterwards ${refreshAfterRevoke.status} ${JSON.parse(refreshAfterRevoke.body).error ?? ''}`,
  );

  // oauth.service.ts revokeToken() says so in its own comment ("RFC 7009 2.1:
  // only the issuing client may revoke; access tokens stay valid until
  // expiry"): the access token is a self-contained JWT and nothing checks a
  // revocation list on /mcp. Measured, not asserted green -- it is a real
  // window and it belongs in the doc, not in a passing step.
  const accessAfterRevoke = await mcpCall('tools/list', {}, { token: tokens.access_token });
  note(
    `after revocation the already-minted access token still answers ${accessAfterRevoke.status} on /mcp and keeps working for the rest of its ${tokens.expires_in}s lifetime (upstream design: stateless JWT access tokens, oauth.service.ts revokeToken)`,
  );

  const tampered = await mcpCall('tools/list', {}, { token: `${tokens.access_token.slice(0, -2)}xx` });
  record(
    'a tampered access token is refused by /mcp with 401',
    tampered.status === 401,
    `status ${tampered.status}`,
  );

  const failed = steps.filter((s) => !s.ok);
  console.log(`\n${failed.length === 0 ? '[PASS]' : '[FAIL]'} OAuth probe: ${steps.length - failed.length}/${steps.length} steps passed`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((error) => die(error.stack || error.message));
