import {
  BETTY_GUIDE_PROFILE_NOTE_TITLE,
  BETTY_GUIDE_SKILL_NAME,
  createStartBettyGuideTool,
  startBettyGuideInputSchema,
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

    expect(JSON.stringify(result)).not.toContain('Guide body');
    expect(result.guideSummary.length).toBeLessThan(1300);
    expect(result.fullGuide).toContain('load_skills');
    expect(result.fullGuide).toContain(BETTY_GUIDE_SKILL_NAME);
    expect(result.profileNote).toBeNull();
    expect(result.nextStep).toContain('Reply with firstMessage');
  });

  it('puts the whole reply in firstMessage, with the name when given', async () => {
    const tool = createStartBettyGuideTool(
      buildSkillServiceMock([
        { name: BETTY_GUIDE_SKILL_NAME, content: 'Guide body' },
      ]) as never,
      buildWorkspaceOrmManagerMock(null) as never,
      'workspace-a',
      ROLE_PERMISSION_CONFIG,
    );

    const named = await tool.execute({ name: 'Andrés' });
    const anonymous = await tool.execute({});

    expect(named.firstMessage).toBe(
      '¡Hola, Andrés! Soy Betty. Quiero entender cómo trabajas para proponerte las formas de usarme que más te ayuden. Para empezar: ¿a qué te dedicas y cómo es tu día a día?',
    );
    expect(anonymous.firstMessage).toBe(
      '¡Hola! Soy Betty. Quiero entender cómo trabajas para proponerte las formas de usarme que más te ayuden. Para empezar: ¿a qué te dedicas y cómo es tu día a día?',
    );
  });

  it('tells the assistant not to offer menus', () => {
    const tool = createStartBettyGuideTool(
      buildSkillServiceMock() as never,
      buildWorkspaceOrmManagerMock(null) as never,
      'workspace-a',
      ROLE_PERMISSION_CONFIG,
    );

    expect(tool.description).toContain('Do not list options');
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
    expect(result.firstMessage).toContain('Andrés sells software to dentists');
    expect(result.firstMessage).toContain('¿Sigue siendo así');
    expect(result.nextStep).toContain('Reply with firstMessage');
  });

  describe('profile summary and name in firstMessage', () => {
    const runWith = async (markdown: string | null, name?: string) => {
      const tool = createStartBettyGuideTool(
        buildSkillServiceMock([
          { name: BETTY_GUIDE_SKILL_NAME, content: 'Guide body' },
        ]) as never,
        buildWorkspaceOrmManagerMock(
          markdown === null ? null : { bodyV2: { markdown } },
        ) as never,
        'workspace-a',
        ROLE_PERMISSION_CONFIG,
      );

      return (await tool.execute({ name })).firstMessage;
    };

    it('skips the note title and heading markers', async () => {
      const message = await runWith(
        `# ${BETTY_GUIDE_PROFILE_NOTE_TITLE}\n\n\n## Vendo software a dentistas.\nMás detalle`,
      );

      expect(message).toBe(
        '¡Hola! Soy Betty. Por lo que tengo guardado de tu trabajo: Vendo software a dentistas. ¿Sigue siendo así o ha cambiado algo?',
      );
    });

    it('ends the summary with a period when it has no final punctuation', async () => {
      const message = await runWith('Vendo software a dentistas');

      expect(message).toContain('dentistas. ¿Sigue siendo así');
      expect(message).not.toContain('dentistas ¿');
    });

    it('keeps existing final punctuation and trims to about 160 characters', async () => {
      const kept = await runWith('¿Qué hago hoy?');
      const long = await runWith(`${'palabra '.repeat(60)}fin`);
      const summary = long
        .replace(
          '¡Hola! Soy Betty. Por lo que tengo guardado de tu trabajo: ',
          '',
        )
        .replace(' ¿Sigue siendo así o ha cambiado algo?', '');

      expect(kept).toContain('¿Qué hago hoy? ¿Sigue');
      expect(kept).not.toContain('hoy?.');
      expect(summary.length).toBeLessThanOrEqual(162);
      expect(summary).toMatch(/\.$/);
    });

    it('uses the no-profile message when the note has no content line', async () => {
      const empty = await runWith('  \n\n');
      const onlyTitle = await runWith(`# ${BETTY_GUIDE_PROFILE_NOTE_TITLE}\n`);

      expect(empty).toContain('¿a qué te dedicas');
      expect(onlyTitle).toContain('¿a qué te dedicas');
    });

    it('trims the name, drops control characters and caps it at 40 characters', async () => {
      const odd = await runWith(null, `  An\u0000dr\u001bés\n\t  `);
      const long = await runWith(null, 'x'.repeat(100));
      const blank = await runWith(null, ' \u0007\n ');

      expect(odd.startsWith('¡Hola, Andrés! Soy Betty')).toBe(true);
      expect(long.startsWith(`¡Hola, ${'x'.repeat(40)}! Soy`)).toBe(true);
      expect(blank.startsWith('¡Hola! Soy Betty')).toBe(true);
    });

    it('rejects names over the cap in the input schema', () => {
      expect(
        startBettyGuideInputSchema.safeParse({ name: 'x'.repeat(500) }).success,
      ).toBe(false);
      expect(
        startBettyGuideInputSchema.safeParse({ name: 'x'.repeat(40) }).success,
      ).toBe(true);
    });
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

    expect(result.firstMessage).toContain('Andrés');
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

    expect(result.guideSummary).toContain('not available');
    expect(result.firstMessage).toContain('¿a qué te dedicas');
  });

  it('still returns the guide and a nextStep when reading the profile note is denied', async () => {
    const skillService = buildSkillServiceMock([
      { name: BETTY_GUIDE_SKILL_NAME, content: 'Guide body' },
    ]);
    const workspaceOrmManager = buildWorkspaceOrmManagerMock(null);

    workspaceOrmManager.findOne.mockRejectedValue(
      new Error('Permission denied: cannot read note'),
    );

    const tool = createStartBettyGuideTool(
      skillService as never,
      workspaceOrmManager as never,
      'workspace-a',
      ROLE_PERMISSION_CONFIG,
    );

    const result = await tool.execute({});

    expect(result.guideSummary.length).toBeGreaterThan(0);
    expect(result.profileNote).toBeNull();
    expect(result.nextStep.length).toBeGreaterThan(0);
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
  });
});
