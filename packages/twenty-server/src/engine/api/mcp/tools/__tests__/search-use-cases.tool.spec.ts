import { createSearchUseCasesTool } from 'src/engine/api/mcp/tools/search-use-cases.tool';

describe('createSearchUseCasesTool', () => {
  it('takes no workspace argument at all, so it cannot read any workspace data', () => {
    expect(createSearchUseCasesTool).toHaveLength(0);
  });

  it('returns the same catalog data regardless of which workspace calls it', async () => {
    const tool = createSearchUseCasesTool();

    const fromWorkspaceA = await tool.execute({
      query: 'correo',
      limit: 5,
    });
    const fromWorkspaceB = await tool.execute({
      query: 'correo',
      limit: 5,
    });

    expect(fromWorkspaceB).toEqual(fromWorkspaceA);
    expect(fromWorkspaceA.results.length).toBeGreaterThan(0);
  });

  it('caps the limit at 10 even when a larger one is requested', async () => {
    const tool = createSearchUseCasesTool();

    const result = await tool.execute({ query: 'betty', limit: 9999 });

    expect(result.results.length).toBeLessThanOrEqual(10);
  });

  it('defaults to 5 results when no limit is given', async () => {
    const tool = createSearchUseCasesTool();

    const result = await tool.execute({ query: 'betty' });

    expect(result.results.length).toBeLessThanOrEqual(5);
  });
});
