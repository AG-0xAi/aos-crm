import { z } from 'zod';

import {
  BETTY_LIMITS_TO_STATE,
  BETTY_USE_CASES,
} from 'src/engine/api/mcp/catalog/betty-use-case-catalog.data';
import {
  type BettyUseCaseSearchResult,
  searchBettyUseCases,
} from 'src/engine/api/mcp/utils/search-betty-use-cases.util';

export const SEARCH_USE_CASES_TOOL_NAME = 'search_use_cases';

const DEFAULT_RESULT_LIMIT = 5;
const MAX_RESULT_LIMIT = 10;

export const searchUseCasesInputSchema = z.object({
  query: z
    .string()
    .describe(
      'Free text describing what the person wants to do, in Spanish or English',
    ),
  category: z.string().optional().describe('Filter by exact category name'),
  persona: z
    .string()
    .optional()
    .describe('Filter by a word or phrase from the target persona'),
  connector: z
    .string()
    .optional()
    .describe('Filter by a connector the case lists, e.g. "Gmail"'),
  limit: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      `Max results, default ${DEFAULT_RESULT_LIMIT}, capped at ${MAX_RESULT_LIMIT}`,
    ),
});

export type SearchUseCasesResult = {
  results: BettyUseCaseSearchResult[];
  message: string;
};

export const createSearchUseCasesTool = () => ({
  description:
    "Search the catalog of Betty use cases by free text and optional filters (category, persona, connector). Read-only: it never reads this workspace's own data, only the static catalog shipped with the server.",
  inputSchema: searchUseCasesInputSchema,
  execute: async ({
    query,
    category,
    persona,
    connector,
    limit,
  }: z.infer<
    typeof searchUseCasesInputSchema
  >): Promise<SearchUseCasesResult> => {
    const resolvedLimit = Math.min(
      Math.max(limit ?? DEFAULT_RESULT_LIMIT, 1),
      MAX_RESULT_LIMIT,
    );

    const results = searchBettyUseCases({
      query,
      filters: { category, persona, connector },
      limit: resolvedLimit,
      useCases: BETTY_USE_CASES,
      limitsToState: BETTY_LIMITS_TO_STATE,
    });

    return {
      results,
      message:
        results.length > 0
          ? `Found ${results.length} use case(s).`
          : 'No matching use case was found in the catalog.',
    };
  },
});
