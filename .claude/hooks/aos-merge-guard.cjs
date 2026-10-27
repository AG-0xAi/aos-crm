'use strict';
const fs = require('fs');
let p = {};
try { p = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch (_) {}
const tool = String(p.tool_name || '');
const cmd  = String((p.tool_input && p.tool_input.command) || '');
if (tool === 'Bash') {
  const MERGE_PATTERNS = [
    /\bgh\s+pr\s+merge\b/i,
    /\bgit\s+push\b[^|&;\n]*\s(main|master)(\s|$)/i
  ];
  if (MERGE_PATTERNS.some(function(re) { return re.test(cmd); })) {
    process.stderr.write(
      '[AOS-MERGE-GUARD] BLOQUEADO: un worker no puede fusionar su propio PR ni ' +
      'empujar directo a ramas protegidas (main/master). Spec: worker-authority-witness Req 4. ' +
      'Abre un PR y deja que el S-00 lo revise y fusione.'
    );
    process.exit(2);
  }
}
process.exit(0);
