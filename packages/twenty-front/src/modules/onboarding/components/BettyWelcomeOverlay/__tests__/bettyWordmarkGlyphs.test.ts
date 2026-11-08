import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';

import {
  BETTY_WORDMARK_DOT,
  BETTY_WORDMARK_GLYPHS,
  BETTY_WORDMARK_VIEW_BOX,
} from '@/onboarding/components/BettyWelcomeOverlay/bettyWordmarkGlyphs';

const WORDMARK_SVG_PATH = join(
  __dirname,
  '../../../../../../public/brand/logo/betty-wordmark-primary.svg',
);

// Confirms the approved SVG this file was copied byte for byte from (per the
// spec's manifest) hasn't drifted out from under this test.
const WORDMARK_SVG_SHA256 =
  '611af7e39708bbb891de52448649339b7d6ac0b7ba022b17a1329168de23c81c';

describe('bettyWordmarkGlyphs', () => {
  const svgContent = readFileSync(WORDMARK_SVG_PATH, 'utf-8');

  it('matches the approved wordmark SVG checked into public/brand/logo', () => {
    const sha256 = createHash('sha256').update(svgContent).digest('hex');

    expect(sha256).toBe(WORDMARK_SVG_SHA256);
  });

  it('reuses the SVG viewBox', () => {
    const [, viewBox] = svgContent.match(/viewBox="([^"]+)"/) ?? [];

    expect(viewBox?.split(' ').map(Number)).toEqual([
      ...BETTY_WORDMARK_VIEW_BOX,
    ]);
  });

  it('copies every glyph path byte for byte from the SVG', () => {
    for (const glyph of BETTY_WORDMARK_GLYPHS) {
      const [, d] =
        svgContent.match(new RegExp(`class="betty-${glyph.id}" d="([^"]+)"`)) ??
        [];

      expect(d).toBe(glyph.d);
    }
  });

  it('copies the dot circle byte for byte from the SVG', () => {
    const [, cx] = svgContent.match(/class="betty-dot" cx="([^"]+)"/) ?? [];
    const [, cy] = svgContent.match(/cy="([^"]+)"/) ?? [];
    const [, r] = svgContent.match(/class="betty-dot"[^>]*r="([^"]+)"/) ?? [];

    expect(Number(cx)).toBe(BETTY_WORDMARK_DOT.cx);
    expect(Number(cy)).toBe(BETTY_WORDMARK_DOT.cy);
    expect(Number(r)).toBe(BETTY_WORDMARK_DOT.r);
  });
});
