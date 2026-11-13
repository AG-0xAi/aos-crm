// These skills only teach the `code_interpreter` tool, which MCP never offers
// (MCP_EXCLUDED_TOOL_NAMES) and which the driver itself refuses to run while
// CODE_INTERPRETER_TYPE is DISABLED. Offering them anyway would menu a skill
// the assistant can never execute.
export const MCP_CODE_INTERPRETER_SKILL_NAMES = new Set([
  'code-interpreter',
  'xlsx',
  'pdf',
  'docx',
  'pptx',
]);
