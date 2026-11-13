export const normalizeBettySearchText = (text: string): string =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

const BETTY_SEARCH_STOP_WORDS = new Set([
  'los',
  'las',
  'del',
  'una',
  'uno',
  'unos',
  'unas',
  'por',
  'para',
  'con',
  'sin',
  'sus',
  'que',
  'como',
  'mas',
  'muy',
  'pero',
  'sobre',
  'entre',
  'desde',
  'hasta',
  'este',
  'esta',
  'estos',
  'estas',
  'ese',
  'esa',
  'son',
  'ser',
  'hay',
  'the',
  'and',
  'for',
  'with',
  'from',
  'that',
  'this',
  'these',
  'those',
  'are',
  'was',
  'were',
  'into',
  'about',
  'your',
  'our',
  'their',
  'has',
  'have',
  'not',
  'but',
  'all',
  'can',
]);

export const splitBettySearchWords = (text: string): string[] =>
  normalizeBettySearchText(text)
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3 && !BETTY_SEARCH_STOP_WORDS.has(word));
