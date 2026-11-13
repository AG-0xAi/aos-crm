import { truncateMcpSkillDescription } from 'src/engine/api/mcp/utils/truncate-mcp-skill-description.util';

describe('truncateMcpSkillDescription', () => {
  it('collapses internal whitespace and newlines to single spaces', () => {
    expect(truncateMcpSkillDescription('Use when   the user\nwants X')).toBe(
      'Use when the user wants X',
    );
  });

  it('returns the description unchanged when under the limit', () => {
    expect(truncateMcpSkillDescription('short description')).toBe(
      'short description',
    );
  });

  it('truncates with an ellipsis when over the limit', () => {
    const longDescription = 'a'.repeat(250);

    const result = truncateMcpSkillDescription(longDescription);

    expect(result.length).toBe(200);
    expect(result.endsWith('…')).toBe(true);
    expect(result.startsWith('a'.repeat(199))).toBe(true);
  });
});
