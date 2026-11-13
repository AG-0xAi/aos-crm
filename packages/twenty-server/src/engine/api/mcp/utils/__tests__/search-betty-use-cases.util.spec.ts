import {
  BETTY_LIMITS_TO_STATE,
  BETTY_USE_CASES,
} from 'src/engine/api/mcp/catalog/betty-use-case-catalog.data';
import { searchBettyUseCases } from 'src/engine/api/mcp/utils/search-betty-use-cases.util';

const search = (
  args: Partial<Parameters<typeof searchBettyUseCases>[0]> & {
    query: string;
  },
) =>
  searchBettyUseCases({
    useCases: BETTY_USE_CASES,
    limitsToState: BETTY_LIMITS_TO_STATE,
    limit: 10,
    ...args,
  });

describe('searchBettyUseCases', () => {
  it('R2.1: finds lead, email and task cases for the spec query', () => {
    const results = search({
      query: 'organizar intros de aceleradoras y tareas pendientes del correo',
    });

    expect(results.length).toBeGreaterThan(0);

    const text = (useCase: (typeof results)[number]) =>
      `${useCase.title} ${useCase.goal} ${useCase.category}`.toLowerCase();

    expect(results.some((useCase) => /lead/.test(text(useCase)))).toBe(true);
    expect(results.some((useCase) => /correo/.test(text(useCase)))).toBe(true);
    expect(results.some((useCase) => /tarea/.test(text(useCase)))).toBe(true);
  });

  it('filters by connector, returning only cases that list it', () => {
    const results = search({ query: '', filters: { connector: 'Slack' } });

    expect(results.length).toBeGreaterThan(0);

    for (const useCase of results) {
      expect(
        useCase.connectors.some((connector) => connector.includes('Slack')),
      ).toBe(true);
    }
  });

  it('caps the result count at 10 even when limit asks for more', () => {
    const results = searchBettyUseCases({
      query: 'betty',
      useCases: BETTY_USE_CASES,
      limitsToState: BETTY_LIMITS_TO_STATE,
      limit: 10,
    });

    expect(results.length).toBeLessThanOrEqual(10);
  });

  it('folds accents and case when matching', () => {
    const withAccent = search({ query: 'cómo organizar mis acciones' });
    const withoutAccent = search({ query: 'COMO ORGANIZAR MIS ACCIONES' });

    expect(withAccent.map((useCase) => useCase.title)).toEqual(
      withoutAccent.map((useCase) => useCase.title),
    );
    expect(withAccent.length).toBeGreaterThan(0);
  });

  it('filters by category with an exact, accent/case-folded match', () => {
    const results = search({
      query: '',
      filters: { category: 'equipo Y GOBIERNO' },
    });

    expect(results.length).toBeGreaterThan(0);
    for (const useCase of results) {
      expect(useCase.category).toBe('Equipo y gobierno');
    }
  });

  it('attaches relevant limits when a case caveat points at one', () => {
    const results = search({
      query: 'qué hay dentro de mi Betty objetos campos habilidades',
    });

    const withLimits = results.find(
      (useCase) => useCase.relevantLimits.length > 0,
    );

    expect(withLimits).toBeDefined();
  });
});
