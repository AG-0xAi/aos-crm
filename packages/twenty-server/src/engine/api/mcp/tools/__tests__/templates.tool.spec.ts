import { BETTY_TEMPLATES } from 'src/engine/api/mcp/constants/betty-template-catalog.constant';
import { createInstallTemplateTool } from 'src/engine/api/mcp/tools/install-template.tool';
import { createListTemplatesTool } from 'src/engine/api/mcp/tools/list-templates.tool';

const FINANZAS = BETTY_TEMPLATES[0];
const WORKSPACE_A = 'workspace-a';
const WORKSPACE_B = 'workspace-b';

type World = {
  registered: boolean;
  installedIn: Set<string>;
  adminOf: Set<string>;
  installFails?: boolean;
};

const buildWorld = (overrides: Partial<World> = {}): World => ({
  registered: true,
  installedIn: new Set(),
  adminOf: new Set([WORKSPACE_A, WORKSPACE_B]),
  ...overrides,
});

const buildServices = (world: World) => {
  const install = jest.fn(
    async ({ workspaceId }: { workspaceId: string }): Promise<boolean> => {
      if (world.installFails) {
        throw new Error('boom');
      }
      world.installedIn.add(workspaceId);

      return true;
    },
  );

  return {
    install,
    applicationRegistrationLookupService: {
      findOneByUniversalIdentifierGlobal: jest.fn(async () =>
        world.registered ? { id: 'registration-1' } : null,
      ),
    } as never,
    applicationLookupService: {
      findByUniversalIdentifier: jest.fn(
        async ({ workspaceId }: { workspaceId: string }) =>
          world.installedIn.has(workspaceId) ? { version: '1.0.0' } : null,
      ),
    } as never,
    permissionsService: {
      userHasWorkspaceSettingPermission: jest.fn(
        async ({ workspaceId }: { workspaceId: string }) =>
          world.adminOf.has(workspaceId),
      ),
    } as never,
    applicationInstallService: { installApplication: install } as never,
  };
};

const buildInstallTool = (world: World, workspaceId: string) => {
  const services = buildServices(world);
  const tool = createInstallTemplateTool({
    caller: {
      workspaceId,
      userWorkspaceId: 'user-workspace-1',
      apiKeyId: undefined,
      applicationId: undefined,
      agentId: undefined,
    },
    ...services,
  });

  return { tool, install: services.install };
};

describe('list_templates', () => {
  it('hides templates that are not registered on the server', async () => {
    const services = buildServices(buildWorld({ registered: false }));
    const tool = createListTemplatesTool({
      workspaceId: WORKSPACE_A,
      ...services,
    });

    await expect(tool.execute()).resolves.toEqual({ templates: [] });
  });

  it('lists registered templates and reports installed per workspace', async () => {
    const world = buildWorld({ installedIn: new Set([WORKSPACE_A]) });
    const services = buildServices(world);

    const fromA = await createListTemplatesTool({
      workspaceId: WORKSPACE_A,
      ...services,
    }).execute();
    const fromB = await createListTemplatesTool({
      workspaceId: WORKSPACE_B,
      ...services,
    }).execute();

    expect(fromA.templates.map((template) => template.id)).toEqual([
      FINANZAS.id,
    ]);
    expect(fromA.templates[0].installed).toBe(true);
    expect(fromB.templates[0].installed).toBe(false);
    expect(fromA.templates[0].entryPoints).toEqual(FINANZAS.entryPoints);
  });
});

describe('install_template', () => {
  it('installs once and answers already_installed on the second call without installing again', async () => {
    const world = buildWorld();
    const { tool, install } = buildInstallTool(world, WORKSPACE_A);

    const first = await tool.execute({ templateId: 'finanzas' });
    const second = await tool.execute({ templateId: 'finanzas' });

    expect(first).toEqual({
      success: true,
      status: 'installed',
      entryPoints: FINANZAS.entryPoints,
      minimumSetup:
        'moneda principal y una cuenta con su saldo inicial y su fecha de corte',
    });
    expect(second).toEqual({
      success: true,
      status: 'already_installed',
      entryPoints: FINANZAS.entryPoints,
    });
    expect(install).toHaveBeenCalledTimes(1);
  });

  it('never installs in another workspace: the workspace comes from the caller, not from input', async () => {
    const world = buildWorld();
    const { tool, install } = buildInstallTool(world, WORKSPACE_B);

    await tool.execute({
      templateId: 'finanzas',
      workspaceId: WORKSPACE_A,
    } as never);

    expect(install).toHaveBeenCalledTimes(1);
    expect(install).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: WORKSPACE_B }),
    );
    expect(world.installedIn.has(WORKSPACE_A)).toBe(false);
    expect(world.installedIn.has(WORKSPACE_B)).toBe(true);
  });

  it('does not accept a workspace id in its input schema', () => {
    const { tool } = buildInstallTool(buildWorld(), WORKSPACE_A);

    expect(Object.keys(tool.inputSchema.shape)).toEqual(['templateId']);
  });

  it('refuses a caller without the permission to manage applications', async () => {
    const world = buildWorld({ adminOf: new Set() });
    const { tool, install } = buildInstallTool(world, WORKSPACE_A);

    const result = await tool.execute({ templateId: 'finanzas' });

    expect(result).toMatchObject({ success: false, status: 'forbidden' });
    expect(result).toMatchObject({
      message: expect.stringContaining(
        'Pídele a quien administra el espacio que la active',
      ),
    });
    expect(install).not.toHaveBeenCalled();
  });

  it('errors on an unknown template id', async () => {
    const { tool, install } = buildInstallTool(buildWorld(), WORKSPACE_A);

    await expect(tool.execute({ templateId: 'nope' })).resolves.toMatchObject({
      success: false,
      status: 'unknown_template',
    });
    expect(install).not.toHaveBeenCalled();
  });

  it('errors when the template is known but not registered on this server', async () => {
    const { tool, install } = buildInstallTool(
      buildWorld({ registered: false }),
      WORKSPACE_A,
    );

    await expect(
      tool.execute({ templateId: 'finanzas' }),
    ).resolves.toMatchObject({ success: false, status: 'unknown_template' });
    expect(install).not.toHaveBeenCalled();
  });

  it('reports an install failure without claiming it is active', async () => {
    const { tool } = buildInstallTool(
      buildWorld({ installFails: true }),
      WORKSPACE_A,
    );

    const result = await tool.execute({ templateId: 'finanzas' });

    expect(result).toMatchObject({ success: false, status: 'failed' });
    expect(result).not.toHaveProperty('entryPoints');
  });
});
