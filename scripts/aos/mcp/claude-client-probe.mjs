#!/usr/bin/env node
// CRM-007 R2: a real assistant client against this MCP server.
//
// `claude -p` is used here ONLY as an MCP client -- the thing a team member
// will point at the CRM tomorrow -- restricted to this one server and to its
// tools. It is not part of the gate: a model-driven run is not deterministic,
// so what the gate asserts is in scripts/aos/test/crm-mcp-e2e.test.mjs, and
// this probe answers the separate question of whether a real client can drive
// the connector at all.
//
//   node scripts/aos/mcp/claude-client-probe.mjs
//
// Restrictions, all deliberate:
//   --strict-mcp-config   only the server in the config this script writes;
//                         no .mcp.json, no user-scoped server
//   --allowedTools mcp__aos-crm   only this server's tools; no Bash, no file
//                         access, no other MCP server
//   --max-turns 12        bounded
//   --model sonnet
//
// The credential never reaches the config file or the command line: the file
// carries the literal ${AOS_CRM_MCP_API_KEY} and the child process is given
// that variable. The config file is written outside the repo and deleted.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { BASE_URL, mcpCall, readLocalApiKey, unwrapToolResult } from './lib.mjs';

const SERVER_NAME = 'aos-crm';
const MAX_TURNS = 12;
const COMPANY_NAME = `AOS-CRM claude-client probe ${Date.now()}`;

const PROMPT = [
  `You are connected to a CRM through the MCP server "${SERVER_NAME}". Use only its tools.`,
  `Do all three steps, then stop:`,
  `1. List the object names this workspace has.`,
  `2. Create one company named exactly "${COMPANY_NAME}" and report the id you got back.`,
  `3. Read that company back by its id and report its name.`,
  `Finish with one line: OBJECTS=<how many object names> ID=<the company id> NAME=<the name you read back>`,
].join('\n');

function main() {
  const apiKey = readLocalApiKey();
  const dir = mkdtempSync(resolve(tmpdir(), 'aos-crm-mcp-probe-'));
  const configPath = resolve(dir, 'mcp.json');

  try {
    writeFileSync(
      configPath,
      JSON.stringify(
        {
          mcpServers: {
            [SERVER_NAME]: {
              type: 'http',
              url: `${BASE_URL}/mcp`,
              headers: { Authorization: 'Bearer ${AOS_CRM_MCP_API_KEY}' },
            },
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    console.log(`[INFO] running claude -p as an MCP client of ${BASE_URL}/mcp (credential length ${apiKey.length}, max ${MAX_TURNS} turns)`);
    // The prompt goes in on STDIN, not in argv. Measured on 2026-10-29: with
    // the multi-line prompt in argv under `shell: true`, cmd.exe ate it and
    // every flag after it -- the client received the single word "You", loaded
    // this repo's CLAUDE.md and ran `aos status` with tools --allowedTools was
    // supposed to have excluded. Dropping the shell is not the fix either:
    // `claude` on Windows is a .cmd shim and Node refuses to spawn .cmd
    // without a shell (EINVAL, the CVE-2024-27980 mitigation). So: shell on,
    // every remaining argument a single quoted token, and nothing
    // free-form on the command line.
    const args = [
      '-p',
      '--mcp-config', JSON.stringify(configPath),
      '--strict-mcp-config',
      '--allowedTools', `mcp__${SERVER_NAME}`,
      '--model', 'sonnet',
      '--max-turns', String(MAX_TURNS),
    ];
    const res = spawnSync('claude', args, {
      encoding: 'utf8',
      input: PROMPT,
      maxBuffer: 32 * 1024 * 1024,
      timeout: 420_000,
      env: { ...process.env, AOS_CRM_MCP_API_KEY: apiKey },
      shell: true,
      // A neutral working directory: run from the checkout and the client
      // picks up this project's CLAUDE.md, which is a different experiment.
      // What is being probed is a bare MCP client.
      cwd: dir,
    });

    const output = `${res.stdout || ''}\n${res.stderr || ''}`.trim();
    console.log('--- client output ---');
    console.log(output.slice(-2000));
    console.log('--- end client output ---');

    if (res.status !== 0) {
      console.error(`[FAIL] the client exited ${res.status ?? 'unmeasured'}${res.error ? ` (${res.error.code || res.error.message})` : ''}`);
      process.exit(1);
    }

    // The client's own words are not evidence of a write. The verdict is the
    // record, read back over MCP by this process, and then cleaned up.
    return verifyAndCleanUp(output);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function verifyAndCleanUp(clientOutput) {
  const apiKey = readLocalApiKey();
  const found = unwrapToolResult(
    await mcpCall(
      'tools/call',
      {
        name: 'execute_tool',
        arguments: {
          toolName: 'find_many_companies',
          arguments: { name: { eq: COMPANY_NAME }, select: ['id', 'name'], limit: 2 },
        },
      },
      { apiKey },
    ),
  );
  const records = found.payload?.result ?? [];
  const record = Array.isArray(records) ? records[0] : records?.records?.[0];

  if (!record?.id) {
    console.error(`[FAIL] the client reported its work but no company named "${COMPANY_NAME}" exists: ${JSON.stringify(found.payload).slice(0, 300)}`);
    process.exit(1);
  }
  console.log(`[PASS] the client created the company through MCP: ${record.id}`);
  console.log(`[PASS] the client's final line mentions the id it reported: ${clientOutput.includes(record.id)}`);

  const deleted = unwrapToolResult(
    await mcpCall(
      'tools/call',
      { name: 'execute_tool', arguments: { toolName: 'delete_one_company', arguments: { id: record.id } } },
      { apiKey },
    ),
  );
  console.log(`${deleted.ok ? '[PASS]' : '[FAIL]'} the probe's own record was deleted afterwards`);
  process.exit(deleted.ok ? 0 : 1);
}

await main();
