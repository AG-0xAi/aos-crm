import { STANDARD_SKILL } from 'src/engine/workspace-manager/twenty-standard-application/constants/standard-skill.constant';
import { computeTwentyStandardApplicationAllFlatEntityMaps } from 'src/engine/workspace-manager/twenty-standard-application/utils/twenty-standard-application-all-flat-entity-maps.constant';

const WORKSPACE_ID = '20202020-0000-0000-0000-000000000001';
const STANDARD_APPLICATION_ID = '20202020-0000-0000-0000-0000000000a1';

describe('betty-guia standard skill', () => {
  const { allFlatEntityMaps } =
    computeTwentyStandardApplicationAllFlatEntityMaps({
      now: '2026-01-01T00:00:00.000Z',
      workspaceId: WORKSPACE_ID,
      twentyStandardApplicationId: STANDARD_APPLICATION_ID,
    });

  const bettyGuia =
    allFlatEntityMaps.flatSkillMaps.byUniversalIdentifier[
      STANDARD_SKILL['betty-guia'].universalIdentifier
    ];

  it('is present in the standard skill set, titled "Conóceme"', () => {
    expect(bettyGuia).toBeDefined();
    expect(bettyGuia?.name).toBe('betty-guia');
    expect(bettyGuia?.label).toBe('Conóceme');
    expect(bettyGuia?.isSystem).toBe(true);
  });

  it('tells the assistant to look for the profile note first', () => {
    expect(bettyGuia?.content).toContain('Mi perfil de trabajo con Betty');
  });

  it('requires consent before building or saving', () => {
    expect(bettyGuia?.content.toLowerCase()).toContain('consentimiento');
    expect(bettyGuia?.content).toContain('pide permiso');
  });

  it('tells the assistant to call search_use_cases', () => {
    expect(bettyGuia?.content).toContain('search_use_cases');
  });
});

describe('conectar-correo standard skill', () => {
  const { allFlatEntityMaps } =
    computeTwentyStandardApplicationAllFlatEntityMaps({
      now: '2026-01-01T00:00:00.000Z',
      workspaceId: WORKSPACE_ID,
      twentyStandardApplicationId: STANDARD_APPLICATION_ID,
    });

  const skill =
    allFlatEntityMaps.flatSkillMaps.byUniversalIdentifier[
      STANDARD_SKILL['conectar-correo'].universalIdentifier
    ];

  it('is present in the standard skill set, titled "Conectar tu correo"', () => {
    expect(skill?.name).toBe('conectar-correo');
    expect(skill?.label).toBe('Conectar tu correo');
  });

  it('covers app passwords, key without spaces and Hostinger', () => {
    expect(skill?.content).toContain('apppasswords');
    expect(skill?.content).toContain('sin espacios');
    expect(skill?.content).toContain('Hostinger');
  });
});
