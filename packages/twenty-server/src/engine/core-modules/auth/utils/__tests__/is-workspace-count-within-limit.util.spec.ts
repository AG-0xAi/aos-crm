import { isWorkspaceCountWithinLimit } from 'src/engine/core-modules/auth/utils/is-workspace-count-within-limit.util';

describe('isWorkspaceCountWithinLimit', () => {
  it('should allow any count when the limit is unset', () => {
    expect(
      isWorkspaceCountWithinLimit({
        workspaceCount: 6,
        maxWorkspaces: undefined,
        hasValidEnterpriseKey: false,
      }),
    ).toBe(true);
  });

  it('should allow any count when the limit is zero', () => {
    expect(
      isWorkspaceCountWithinLimit({
        workspaceCount: 6,
        maxWorkspaces: 0,
        hasValidEnterpriseKey: false,
      }),
    ).toBe(true);
  });

  it('should allow a count below a positive limit', () => {
    expect(
      isWorkspaceCountWithinLimit({
        workspaceCount: 2,
        maxWorkspaces: 3,
        hasValidEnterpriseKey: false,
      }),
    ).toBe(true);
  });

  it('should refuse a count at a positive limit', () => {
    expect(
      isWorkspaceCountWithinLimit({
        workspaceCount: 3,
        maxWorkspaces: 3,
        hasValidEnterpriseKey: false,
      }),
    ).toBe(false);
  });

  it('should refuse a count above a positive limit', () => {
    expect(
      isWorkspaceCountWithinLimit({
        workspaceCount: 5,
        maxWorkspaces: 3,
        hasValidEnterpriseKey: false,
      }),
    ).toBe(false);
  });

  it('should allow a count past a positive limit when the enterprise key is valid', () => {
    expect(
      isWorkspaceCountWithinLimit({
        workspaceCount: 5,
        maxWorkspaces: 3,
        hasValidEnterpriseKey: true,
      }),
    ).toBe(true);
  });
});
