'use strict';
// Known-pattern guard, not a sandbox: matches tool_input.command for the two
// tool names Claude Code's PreToolUse can report today (Bash, PowerShell).
// A differently-invoked merge (a third shell tool, curl against the GitHub
// API, an obfuscated command string) is not covered. Report gaps like the
// Bash-only one this file previously had; do not treat silence as proof.
const fs = require('fs');
let p = {};
try { p = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch (_) {}
const tool = String(p.tool_name || '');
const cmd  = String((p.tool_input && p.tool_input.command) || '');
if (tool === 'Bash' || tool === 'PowerShell') {
  const MERGE_PATTERNS = [
    /\bgh\s+pr\s+merge\b/i,
    /\bgit\s+push\b[^|&;\n]*\s(main|master)(\s|$)/i
  ];
  if (MERGE_PATTERNS.some(function(re) { return re.test(cmd); })) {
    process.stderr.write(
      '[AOS-MERGE-GUARD] BLOQUEADO: un worker no puede fusionar su propio PR ni ' +
      'empujar directo a ramas protegidas (main/master). Spec: worker-authority-witness Req 4. ' +
      'Abre el PR y detente: el merge lo hace un humano, nunca S-00 ni otro agente.'
    );
    process.exit(2);
  }
}
process.exit(0);
