import { isDefined } from 'twenty-shared/utils';

import {
  type BettyLimit,
  type BettyUseCase,
} from 'src/engine/api/mcp/catalog/betty-use-case-catalog.data';
import {
  normalizeBettySearchText,
  splitBettySearchWords,
} from 'src/engine/api/mcp/utils/normalize-betty-search-text.util';

export type BettyUseCaseSearchResult = BettyUseCase & {
  relevantLimits: BettyLimit[];
};

export type BettyUseCaseSearchFilters = {
  category?: string;
  persona?: string;
  connector?: string;
};

// Weighted substring match: no outside calls, no embeddings. Title carries
// the most signal, connectors the least since they are near-duplicated
// across many cases.
const SCORED_FIELDS: Array<{
  weight: number;
  getText: (useCase: BettyUseCase) => string;
}> = [
  { weight: 5, getText: (useCase) => useCase.title },
  { weight: 3, getText: (useCase) => useCase.goal },
  { weight: 2, getText: (useCase) => useCase.persona },
  { weight: 2, getText: (useCase) => useCase.category },
  { weight: 2, getText: (useCase) => useCase.bettyFeatures.join(' ') },
  { weight: 1, getText: (useCase) => useCase.connectors.join(' ') },
];

const scoreBettyUseCase = (useCase: BettyUseCase, queryWords: string[]) =>
  SCORED_FIELDS.reduce((score, { weight, getText }) => {
    const normalizedField = normalizeBettySearchText(getText(useCase));
    const matchCount = queryWords.filter((word) =>
      normalizedField.includes(word),
    ).length;

    return score + matchCount * weight;
  }, 0);

// A limit entry is "pointed at" by a case's caveats when they share enough
// distinctive vocabulary - short/common domain words (betty, workspace,
// correo...) are excluded so they cannot inflate the match on their own.
const LIMIT_MATCH_STOP_WORDS = new Set([
  'betty',
  'workspace',
  'chatgpt',
  'claude',
  'correo',
  'correos',
  'conector',
  'conectores',
]);

const extractDistinctiveWords = (text: string): Set<string> =>
  new Set(
    normalizeBettySearchText(text)
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length >= 6 && !LIMIT_MATCH_STOP_WORDS.has(word)),
  );

const findRelevantLimits = (
  useCase: BettyUseCase,
  limitsToState: BettyLimit[],
): BettyLimit[] => {
  const caveatWords = extractDistinctiveWords(useCase.caveats.join(' '));

  if (caveatWords.size === 0) {
    return [];
  }

  return limitsToState.filter((limit) => {
    const limitWords = extractDistinctiveWords(limit);
    let sharedWordCount = 0;

    for (const word of limitWords) {
      if (caveatWords.has(word)) {
        sharedWordCount += 1;
      }
    }

    return sharedWordCount >= 2;
  });
};

const matchesFilters = (
  useCase: BettyUseCase,
  filters: BettyUseCaseSearchFilters | undefined,
): boolean => {
  if (isDefined(filters?.category)) {
    if (
      normalizeBettySearchText(useCase.category) !==
      normalizeBettySearchText(filters.category)
    ) {
      return false;
    }
  }

  if (isDefined(filters?.persona)) {
    if (
      !normalizeBettySearchText(useCase.persona).includes(
        normalizeBettySearchText(filters.persona),
      )
    ) {
      return false;
    }
  }

  if (isDefined(filters?.connector)) {
    const normalizedConnectorFilter = normalizeBettySearchText(
      filters.connector,
    );

    if (
      !useCase.connectors.some((connector) =>
        normalizeBettySearchText(connector).includes(normalizedConnectorFilter),
      )
    ) {
      return false;
    }
  }

  return true;
};

export const searchBettyUseCases = ({
  query,
  filters,
  limit,
  useCases,
  limitsToState,
}: {
  query: string;
  filters?: BettyUseCaseSearchFilters;
  limit: number;
  useCases: BettyUseCase[];
  limitsToState: BettyLimit[];
}): BettyUseCaseSearchResult[] => {
  const queryWords = splitBettySearchWords(query);
  const candidates = useCases.filter((useCase) =>
    matchesFilters(useCase, filters),
  );

  const scored = candidates
    .map((useCase) => ({
      useCase,
      score: scoreBettyUseCase(useCase, queryWords),
    }))
    .filter(({ score }) => queryWords.length === 0 || score > 0);

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, limit).map(({ useCase }) => ({
    ...useCase,
    relevantLimits: findRelevantLimits(useCase, limitsToState),
  }));
};
