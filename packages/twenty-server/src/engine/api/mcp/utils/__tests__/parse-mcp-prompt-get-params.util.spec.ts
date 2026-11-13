import { parseMcpPromptGetParams } from 'src/engine/api/mcp/utils/parse-mcp-prompt-get-params.util';

describe('parseMcpPromptGetParams', () => {
  it('returns the prompt name when params are valid', () => {
    expect(parseMcpPromptGetParams({ name: 'data-manipulation' })).toBe(
      'data-manipulation',
    );
  });

  it('returns undefined when params are missing', () => {
    expect(parseMcpPromptGetParams(undefined)).toBeUndefined();
  });

  it('returns undefined when name is missing or empty', () => {
    expect(parseMcpPromptGetParams({})).toBeUndefined();
    expect(parseMcpPromptGetParams({ name: '' })).toBeUndefined();
  });
});
