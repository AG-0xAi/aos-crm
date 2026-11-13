import {
  BETTY_GUIDE_PROFILE_NOTE_TITLE,
  BETTY_GUIDE_SKILL_NAME,
  createStartBettyGuideTool,
} from 'src/engine/api/mcp/tools/start-betty-guide.tool';
import { type RolePermissionConfig } from 'src/engine/twenty-orm/types/role-permission-config.type';

const ROLE_PERMISSION_CONFIG: RolePermissionConfig = {
  intersectionOf: { userWorkspaceRoleId: 'role-1' },
};

const buildSkillServiceMock = (
  skills: { name: string; content: string }[] = [],
) => ({
  findFlatSkillsByNames: jest.fn().mockResolvedValue(skills),
});

const buildWorkspaceOrmManagerMock = (
  note: { bodyV2?: { markdown?: string } } | null,
) => {
  const findOne = jest.fn().mockResolvedValue(note);
  const getRepository = jest.fn().mockReturnValue({ findOne });

  return {
    executeInWorkspaceContext: jest.fn((fn: () => unknown) => fn()),
    getRepository,
    findOne,
  };
};

describe('createStartBettyGuideTool', () => {
  it('describes the greeting triggers an assistant should call it on', () => {
    const skillService = buildSkillServiceMock();
    const workspaceOrmManager = buildWorkspaceOrmManagerMock(null);

    const tool = createStartBettyGuideTool(
      skillService as never,
      workspaceOrmManager as never,
      'workspace-a',
      ROLE_PERMISSION_CONFIG,
    );

    expect(tool.description).toContain('hola, hello, hi');
    expect(tool.description).toContain('soy Andrés');
    expect(tool.description).toContain('FIRST');
  });

  it('returns the betty-guia content, a null profile note, and a discovery nextStep', async () => {
    const skillService = buildSkillServiceMock([
      { name: BETTY_GUIDE_SKILL_NAME, content: 'Guide body' },
    ]);
    const workspaceOrmManager = buildWorkspaceOrmManagerMock(null);

    const tool = createStartBettyGuideTool(
      skillService as never,
      workspaceOrmManager as never,
      'workspace-a',
      ROLE_PERMISSION_CONFIG,
    );

    const result = await tool.execute({});

    expect(result.guide).toContain('Guide body');
    expect(result.profileNote).toBeNull();
    expect(result.nextStep).toContain('discovery question');
  });

  it('returns the profile note text and a resume-from-profile nextStep when a note exists', async () => {
    const skillService = buildSkillServiceMock([
      { name: BETTY_GUIDE_SKILL_NAME, content: 'Guide body' },
    ]);
    const workspaceOrmManager = buildWorkspaceOrmManagerMock({
      bodyV2: { markdown: 'Andrés sells software to dentists' },
    });

    const tool = createStartBettyGuideTool(
      skillService as never,
      workspaceOrmManager as never,
      'workspace-a',
      ROLE_PERMISSION_CONFIG,
    );

    const result = await tool.execute({});

    expect(result.profileNote).toBe('Andrés sells software to dentists');
    expect(result.nextStep).toContain('already know from their profile note');
  });

  it('names the person in nextStep when a name was given', async () => {
    const skillService = buildSkillServiceMock([
      { name: BETTY_GUIDE_SKILL_NAME, content: 'Guide body' },
    ]);
    const workspaceOrmManager = buildWorkspaceOrmManagerMock(null);

    const tool = createStartBettyGuideTool(
      skillService as never,
      workspaceOrmManager as never,
      'workspace-a',
      ROLE_PERMISSION_CONFIG,
    );

    const result = await tool.execute({ name: 'Andrés' });

    expect(result.nextStep).toContain('Greet Andrés by name');
  });

  it('returns a fallback message and question when betty-guia is missing, not an error', async () => {
    const skillService = buildSkillServiceMock([]);
    const workspaceOrmManager = buildWorkspaceOrmManagerMock(null);

    const tool = createStartBettyGuideTool(
      skillService as never,
      workspaceOrmManager as never,
      'workspace-a',
      ROLE_PERMISSION_CONFIG,
    );

    const result = await tool.execute({});

    expect(result.guide).toContain('not available');
    expect(result.nextStep).toContain('¿A qué te dedicas');
  });

  it('only reads skills and the profile note for the workspace it was built for', async () => {
    const skillServiceA = buildSkillServiceMock([
      { name: BETTY_GUIDE_SKILL_NAME, content: 'Guide A' },
    ]);
    const ormManagerA = buildWorkspaceOrmManagerMock({
      bodyV2: { markdown: "A's profile" },
    });

    const toolA = createStartBettyGuideTool(
      skillServiceA as never,
      ormManagerA as never,
      'workspace-a',
      ROLE_PERMISSION_CONFIG,
    );

    const resultA = await toolA.execute({});

    expect(skillServiceA.findFlatSkillsByNames).toHaveBeenCalledWith(
      [BETTY_GUIDE_SKILL_NAME],
      'workspace-a',
    );
    expect(ormManagerA.getRepository).toHaveBeenCalledWith(
      'note',
      ROLE_PERMISSION_CONFIG,
    );
    expect(ormManagerA.findOne).toHaveBeenCalledWith({
      where: { title: BETTY_GUIDE_PROFILE_NOTE_TITLE },
    });
    expect(resultA.profileNote).toBe("A's profile");

    const skillServiceB = buildSkillServiceMock([
      { name: BETTY_GUIDE_SKILL_NAME, content: 'Guide B' },
    ]);
    const ormManagerB = buildWorkspaceOrmManagerMock({
      bodyV2: { markdown: "B's profile" },
    });

    const toolB = createStartBettyGuideTool(
      skillServiceB as never,
      ormManagerB as never,
      'workspace-b',
      ROLE_PERMISSION_CONFIG,
    );

    const resultB = await toolB.execute({});

    expect(skillServiceB.findFlatSkillsByNames).toHaveBeenCalledWith(
      [BETTY_GUIDE_SKILL_NAME],
      'workspace-b',
    );
    expect(resultB.profileNote).toBe("B's profile");
    expect(resultB.profileNote).not.toBe(resultA.profileNote);
    expect(resultB.guide).not.toBe(resultA.guide);
  });
});
