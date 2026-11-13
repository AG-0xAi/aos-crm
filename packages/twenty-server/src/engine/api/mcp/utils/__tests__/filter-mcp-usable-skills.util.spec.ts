import { filterMcpUsableSkills } from 'src/engine/api/mcp/utils/filter-mcp-usable-skills.util';
import { type FlatSkill } from 'src/engine/metadata-modules/flat-skill/types/flat-skill.type';

const buildSkill = (name: string): FlatSkill =>
  ({ name, label: name, description: null }) as FlatSkill;

describe('filterMcpUsableSkills', () => {
  const skills = [
    buildSkill('data-manipulation'),
    buildSkill('code-interpreter'),
    buildSkill('xlsx'),
    buildSkill('pdf'),
    buildSkill('docx'),
    buildSkill('pptx'),
  ];

  it('keeps every skill when the code interpreter is enabled', () => {
    expect(filterMcpUsableSkills(skills, true)).toEqual(skills);
  });

  it('drops the code-interpreter skills when the code interpreter is disabled', () => {
    const result = filterMcpUsableSkills(skills, false);

    expect(result.map((skill) => skill.name)).toEqual(['data-manipulation']);
  });
});
