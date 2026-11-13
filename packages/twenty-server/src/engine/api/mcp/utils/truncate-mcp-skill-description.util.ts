const MCP_SKILL_DESCRIPTION_MAX_LENGTH = 200;

export const truncateMcpSkillDescription = (description: string): string => {
  const singleLine = description.replace(/\s+/g, ' ').trim();

  return singleLine.length > MCP_SKILL_DESCRIPTION_MAX_LENGTH
    ? `${singleLine.slice(0, MCP_SKILL_DESCRIPTION_MAX_LENGTH - 1)}…`
    : singleLine;
};
