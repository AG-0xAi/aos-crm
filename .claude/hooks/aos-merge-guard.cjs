'use strict';
// Known-pattern guard, not a sandbox: matches tool_input.command for the two
// tool names Claude Code's PreToolUse can report today (Bash, PowerShell).
// A differently-invoked merge (a third shell tool, curl against the GitHub
// API, an obfuscated command string) is not covered. Report gaps like the
// Bash-only one this file previously had; do not treat silence as proof.
//
// Betty runs as an autonomous factory (founder decision, 2026-11-08): the
// coordinator session may merge reviewed PRs. A worker run (the harness sets
// AOS_RUN_ID, AOS_RUN_DIR and AOS_DISPATCH_FILE on every worker it spawns)
// still cannot merge, and nobody pushes straight to the integration branches.
const fs = require('fs');
let p = {};
try { p = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch (_) {}
const tool = String(p.tool_name || '');
const cmd  = String((p.tool_input && p.tool_input.command) || '');
const isWorkerRun = Boolean(
  process.env.AOS_RUN_ID || process.env.AOS_RUN_DIR || process.env.AOS_DISPATCH_FILE
);
if (tool === 'Bash' || tool === 'PowerShell') {
  const MERGE = /\bgh\s+pr\s+merge\b/i;
  const DIRECT_PUSH = /\bgit\s+push\b[^|&;\n]*\s(\S*:)?(main|master|betty\/factory)(\s|$)/i;
  if (DIRECT_PUSH.test(cmd)) {
    process.stderr.write(
      '[AOS-MERGE-GUARD] BLOQUEADO: nadie empuja directo a main, master ni betty/factory. ' +
      'Abre un PR. Spec: worker-authority-witness Req 4.'
    );
    process.exit(2);
  }
  if (MERGE.test(cmd) && isWorkerRun) {
    process.stderr.write(
      '[AOS-MERGE-GUARD] BLOQUEADO: un worker no puede fusionar su propio PR. ' +
      'Abre el PR y detente: lo fusiona el coordinador del bus tras revisarlo. ' +
      'Spec: worker-authority-witness Req 4.'
    );
    process.exit(2);
  }
}
process.exit(0);
