export const isWorkspaceCountWithinLimit = ({
  workspaceCount,
  maxWorkspaces,
  hasValidEnterpriseKey,
}: {
  workspaceCount: number;
  maxWorkspaces: number | undefined;
  hasValidEnterpriseKey: boolean;
}): boolean => {
  if (hasValidEnterpriseKey) {
    return true;
  }

  if (!maxWorkspaces) {
    return true;
  }

  return workspaceCount < maxWorkspaces;
};
