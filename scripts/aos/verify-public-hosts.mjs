// CRM-018 R3: post-deploy smoke check for the hosts the CRM serves once the
// API moved off the apex. Read-only HTTPS GET/POST against a deployed domain:
// no credentials, no AWS calls, no dependencies beyond Node's own fetch.
//
// What it asserts, and why each one is in the contract
// (.aos/pack/aos-crm/specs/api-subdominio/spec.md R3):
//   - api.<domain>/healthz answers 200: the API host resolves, the ALB has a
//     healthy target behind it and the wildcard certificate covers the name.
//   - OAuth discovery at api.<domain> and at the workspace host reports the
//     REQUESTED host as issuer, not a configured one. The server builds it
//     from request.get('host') (oauth-discovery.controller.ts via
//     get-request-base-url.util.ts), so an issuer that disagrees with the URL
//     we asked means TRUST_PROXY or the host header is wrong, and every MCP
//     client would reject the mismatch.
//   - /mcp refuses an anonymous call with 401 and a WWW-Authenticate whose
//     resource_metadata points at that same host (mcp-auth.guard.ts:26-36).
//     That pointer is how ChatGPT and Claude discover where to authorize.
//   - app.<domain> serves the sign-in page, identified by the client-config
//     bootstrap element the server injects (render-frontend-html.util.ts),
//     not merely by a 200.
//
// Exit codes: 0 every check passed; 1 at least one failed; 2 bad usage.
// When a check fails on its subdomain the same probe is repeated against the
// bare apex; if the apex answers what the subdomain did not, the failure is
// reported as "only answers at the apex", which is the exact regression this
// track exists to prevent.
//
// Run:
//   node scripts/aos/verify-public-hosts.mjs --domain <domain> --workspace-host <host>
// Once the apex belongs to the landing, add --require-apex-off to also fail
// if the apex still serves the CRM.
// Self-test (no network, local HTTP server on loopback):
//   node scripts/aos/verify-public-hosts.mjs --self-test

const BOOTSTRAP_ELEMENT_ID = 'twenty-client-config';
const DEFAULT_TIMEOUT_MS = 15000;

const usage = `Usage:
  node scripts/aos/verify-public-hosts.mjs --domain <domain> --workspace-host <host> [--require-apex-off] [--timeout-ms <n>]
  node scripts/aos/verify-public-hosts.mjs --self-test

  --domain          apex of the deployment, e.g. example.test (not a URL)
  --workspace-host  full host of one real workspace, e.g. alice.example.test
  --require-apex-off  also fail if the apex still serves the CRM
`;

function parseArgs(argv) {
  const args = { requireApexOff: false, selfTest: false, timeoutMs: DEFAULT_TIMEOUT_MS };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--self-test') args.selfTest = true;
    else if (arg === '--require-apex-off') args.requireApexOff = true;
    else if (arg === '--domain') args.domain = argv[++i];
    else if (arg === '--workspace-host') args.workspaceHost = argv[++i];
    else if (arg === '--timeout-ms') args.timeoutMs = Number(argv[++i]);
    else throw new Error(`unknown argument '${arg}'\n\n${usage}`);
  }

  if (args.selfTest) return args;

  // A URL here instead of a host silently builds https://https://... and every
  // check fails for the wrong reason.
  const hostPattern = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
  if (!args.domain || !hostPattern.test(args.domain)) {
    throw new Error(`--domain must be a bare domain like example.test\n\n${usage}`);
  }
  if (!args.workspaceHost || !hostPattern.test(args.workspaceHost)) {
    throw new Error(`--workspace-host must be a bare host like alice.example.test\n\n${usage}`);
  }
  if (!args.workspaceHost.endsWith(`.${args.domain}`)) {
    throw new Error(`--workspace-host must be a subdomain of --domain\n\n${usage}`);
  }
  if (!Number.isFinite(args.timeoutMs) || args.timeoutMs <= 0) {
    throw new Error(`--timeout-ms must be a positive number\n\n${usage}`);
  }

  return args;
}

async function request(url, { method = 'GET', timeoutMs }) {
  const response = await fetch(url, {
    method,
    redirect: 'manual',
    headers: method === 'POST' ? { 'content-type': 'application/json' } : {},
    body: method === 'POST' ? '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });

  return {
    status: response.status,
    headers: response.headers,
    body: await response.text(),
  };
}

function parseJsonOrNull(body) {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

// Each probe returns { ok, detail }. `detail` is what gets printed, so it has
// to say what was seen, not just that something was wrong.
const probes = {
  health: async (origin, { timeoutMs }) => {
    const { status } = await request(`${origin}/healthz`, { timeoutMs });
    return { ok: status === 200, detail: `HTTP ${status}` };
  },

  discovery: async (origin, { timeoutMs, apexOrigin }) => {
    const { status, body } = await request(
      `${origin}/.well-known/oauth-authorization-server`,
      { timeoutMs },
    );
    if (status !== 200) return { ok: false, detail: `HTTP ${status}` };

    const metadata = parseJsonOrNull(body);
    if (metadata === null) return { ok: false, detail: 'HTTP 200 but the body is not JSON' };
    if (metadata.issuer !== origin) {
      return { ok: false, detail: `issuer is ${JSON.stringify(metadata.issuer)}, expected ${origin}` };
    }

    // R1: whatever else the metadata says, it must not send the user to the
    // bare apex, which from now on belongs to the landing.
    const authorizeEndpoint = String(metadata.authorization_endpoint ?? '');
    const authorizeOrigin = authorizeEndpoint === '' ? '' : new URL(authorizeEndpoint).origin;
    if (apexOrigin !== undefined && authorizeOrigin === apexOrigin) {
      return { ok: false, detail: `authorization_endpoint points at the apex: ${authorizeEndpoint}` };
    }

    return { ok: true, detail: `issuer ${metadata.issuer}, authorization_endpoint ${authorizeEndpoint}` };
  },

  mcpUnauthorized: async (origin, { timeoutMs }) => {
    const { status, headers } = await request(`${origin}/mcp`, { method: 'POST', timeoutMs });
    if (status !== 401) return { ok: false, detail: `HTTP ${status}, expected 401` };

    const challenge = headers.get('www-authenticate') ?? '';
    const expected = `resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`;
    if (!challenge.includes(expected)) {
      return { ok: false, detail: `401 but WWW-Authenticate is ${JSON.stringify(challenge)}, expected it to contain ${expected}` };
    }
    return { ok: true, detail: `401 with ${expected}` };
  },

  signInPage: async (origin, { timeoutMs }) => {
    const { status, body } = await request(`${origin}/`, { timeoutMs });
    if (status !== 200) return { ok: false, detail: `HTTP ${status}` };
    if (!body.includes(`id="${BOOTSTRAP_ELEMENT_ID}"`)) {
      return { ok: false, detail: `HTTP 200 but the page carries no id="${BOOTSTRAP_ELEMENT_ID}" element, so it is not this CRM's front` };
    }
    return { ok: true, detail: `HTTP 200 with the ${BOOTSTRAP_ELEMENT_ID} bootstrap element` };
  },
};

async function runProbe(probe, origin, options) {
  try {
    return await probes[probe](origin, options);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, detail: `request failed: ${message.slice(0, 200)}` };
  }
}

async function main(args) {
  const { domain, workspaceHost, timeoutMs } = args;

  const apexOrigin = `https://${domain}`;
  const options = { timeoutMs, apexOrigin };
  const checks = [
    { name: 'API health at api', probe: 'health', origin: `https://api.${domain}` },
    { name: 'OAuth discovery at api', probe: 'discovery', origin: `https://api.${domain}` },
    { name: 'OAuth discovery at the workspace host', probe: 'discovery', origin: `https://${workspaceHost}` },
    { name: 'anonymous /mcp refused at api', probe: 'mcpUnauthorized', origin: `https://api.${domain}` },
    { name: 'anonymous /mcp refused at the workspace host', probe: 'mcpUnauthorized', origin: `https://${workspaceHost}` },
    { name: 'sign-in page at app', probe: 'signInPage', origin: `https://app.${domain}` },
  ];

  let failures = 0;

  for (const check of checks) {
    const result = await runProbe(check.probe, check.origin, options);

    if (result.ok) {
      console.log(`[PASS] ${check.name} (${check.origin}): ${result.detail}`);
      continue;
    }

    failures++;
    console.log(`[FAIL] ${check.name} (${check.origin}): ${result.detail}`);

    // The apex probe runs without apexOrigin: there the apex IS the host
    // asked for, so the "do not point at the apex" rule does not apply.
    const atApex = await runProbe(check.probe, apexOrigin, { timeoutMs });
    if (atApex.ok) {
      console.log(`       ...but ${apexOrigin} answers it: this capability STILL ONLY LIVES AT THE APEX.`);
    }
  }

  // The apex serving the CRM is the normal intermediate state between moving
  // the API and handing the apex to the landing, so it is only a failure when
  // the operator says the switch is done.
  const apexFront = await runProbe('signInPage', apexOrigin, { timeoutMs });
  const apexDiscovery = await runProbe('discovery', apexOrigin, { timeoutMs });
  const apexStillServesCrm = apexFront.ok || apexDiscovery.ok;

  if (apexStillServesCrm && args.requireApexOff) {
    failures++;
    console.log(`[FAIL] apex handed over (${apexOrigin}): still serving the CRM (front: ${apexFront.ok}, OAuth discovery: ${apexDiscovery.ok})`);
  } else if (apexStillServesCrm) {
    console.log(`[INFO] ${apexOrigin} still serves the CRM. Expected until the landing takes the apex; re-run with --require-apex-off after the switch.`);
  } else if (failures > 0) {
    // Saying "handed over" here would read as reassurance when the real
    // reading is that nothing answered anywhere.
    console.log(`[INFO] ${apexOrigin} does not serve the CRM either, but checks above failed: do not read this as the handover being done.`);
  } else {
    console.log(`[PASS] apex handed over (${apexOrigin}): no CRM front and no OAuth discovery there`);
  }

  console.log(failures === 0 ? '\nOK: every host answers where it should.' : `\nFAILED: ${failures} check(s).`);

  return failures === 0 ? 0 : 1;
}

// Exercises the probe logic against a local HTTP server that imitates the
// deployed hosts, so the assertions themselves are covered without a
// deployment. Over http:// on loopback; the probes do not care about scheme.
async function selfTest() {
  const { createServer } = await import('node:http');
  const assert = (await import('node:assert/strict')).default;

  let origin = '';
  const server = createServer((req, res) => {
    if (req.url === '/healthz') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"status":"ok"}');
    } else if (req.url === '/.well-known/oauth-authorization-server') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ issuer: origin, authorization_endpoint: `${origin}/authorize` }));
    } else if (req.url === '/mcp') {
      res.writeHead(401, {
        'www-authenticate': `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp", scope="api"`,
      });
      res.end();
    } else if (req.url === '/') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(`<html><head><script id="${BOOTSTRAP_ELEMENT_ID}" type="application/json">{}</script></head></html>`);
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;

  try {
    const options = { timeoutMs: DEFAULT_TIMEOUT_MS };

    for (const probe of ['health', 'discovery', 'mcpUnauthorized', 'signInPage']) {
      const result = await runProbe(probe, origin, options);
      assert.equal(result.ok, true, `${probe} should pass against the imitation host: ${result.detail}`);
      console.log(`[PASS] self-test ${probe}: ${result.detail}`);
    }

    // The apex rule: the same metadata, read from a host whose apex is the
    // authorization_endpoint's origin, must be refused.
    const pointsAtApex = await runProbe('discovery', origin, {
      ...options,
      apexOrigin: origin,
    });
    assert.equal(pointsAtApex.ok, false, 'discovery must refuse an authorization_endpoint on the apex');
    console.log(`[PASS] self-test discovery rejects an apex authorization_endpoint: ${pointsAtApex.detail}`);

    // Same server, wrong origin spelling: every probe that compares the
    // answer against the requested host must notice. This is the regression
    // the deployed check exists for -- an issuer or resource_metadata that
    // names a different host than the one the client asked.
    const aliasOrigin = `http://localhost:${server.address().port}`;
    for (const probe of ['discovery', 'mcpUnauthorized']) {
      const result = await runProbe(probe, aliasOrigin, options);
      assert.equal(result.ok, false, `${probe} must fail when the host it names is not the host asked`);
      console.log(`[PASS] self-test ${probe} rejects a host mismatch: ${result.detail}`);
    }

    // A host that is not the CRM must not pass the front check.
    const notTheCrm = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<html><body>landing</body></html>');
    });
    await new Promise((resolve) => notTheCrm.listen(0, '127.0.0.1', resolve));
    try {
      const landingOrigin = `http://127.0.0.1:${notTheCrm.address().port}`;
      const result = await runProbe('signInPage', landingOrigin, options);
      assert.equal(result.ok, false, 'a 200 that is not the CRM front must not pass');
      console.log(`[PASS] self-test signInPage rejects a non-CRM 200: ${result.detail}`);
    } finally {
      await new Promise((resolve) => notTheCrm.close(resolve));
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  console.log('\nOK: self-test passed.');
  return 0;
}

try {
  const args = parseArgs(process.argv.slice(2));
  process.exitCode = args.selfTest ? await selfTest() : await main(args);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
}
