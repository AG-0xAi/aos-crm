export const normalizeBettySearchText = (text: string): string =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

export const splitBettySearchWords = (text: string): string[] =>
  normalizeBettySearchText(text)
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3);
