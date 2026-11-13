import { MCP_CODE_INTERPRETER_SKILL_NAMES } from 'src/engine/api/mcp/constants/mcp-code-interpreter-skill-names.constant';
import { type FlatSkill } from 'src/engine/metadata-modules/flat-skill/types/flat-skill.type';

export const filterMcpUsableSkills = (
  skills: FlatSkill[],
  isCodeInterpreterEnabled: boolean,
): FlatSkill[] =>
  isCodeInterpreterEnabled
    ? skills
    : skills.filter(
        (skill) => !MCP_CODE_INTERPRETER_SKILL_NAMES.has(skill.name),
      );
