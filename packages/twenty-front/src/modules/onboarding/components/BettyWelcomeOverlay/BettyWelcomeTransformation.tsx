import { BETTY_WELCOME_TRANSFORMATION_START_MS } from '@/onboarding/components/BettyWelcomeOverlay/bettyWelcomeTimeline';
import {
  BETTY_WORDMARK_DOT,
  BETTY_WORDMARK_GLYPHS,
  BETTY_WORDMARK_VIEW_BOX,
} from '@/onboarding/components/BettyWelcomeOverlay/bettyWordmarkGlyphs';
import { styled } from '@linaria/react';
import type { CSSProperties } from 'react';
import { BRAND_COLORS } from 'twenty-shared/constants';
import { doNotTranslate } from 'twenty-shared/i18n';

const EASE_OUT = doNotTranslate('cubic-bezier(.2,.7,.2,1)');
const EASE_IN_OUT = doNotTranslate('cubic-bezier(.65,0,.35,1)');

// Where the figure lands and unravels from (betty-bienvenida.jsx's `ORIGIN`),
// expressed in the wordmark's own viewBox so the strands can be drawn
// straight from there to each glyph's start point.
const ORIGIN: readonly [number, number] = [994, 1050];

const strandPath = (start: readonly [number, number]) => {
  const controlPoint: [number, number] = [
    (ORIGIN[0] + start[0]) / 2,
    Math.min(ORIGIN[1], start[1]) - 140,
  ];

  return doNotTranslate(
    `M${ORIGIN[0]} ${ORIGIN[1]}Q${controlPoint[0]} ${controlPoint[1]} ${start[0]} ${start[1]}`,
  );
};

// Each glyph's strand-draw / outline-trace / fill beat starts 50ms after the
// previous one and takes ~280ms to reach the glyph (betty-bienvenida.jsx's
// `s0 = X + 0.5 + 0.05*i`, `ar = s0 + 0.28`), relative to this scene's start.
const glyphTimingMs = (index: number) => {
  const strandStartMs =
    BETTY_WELCOME_TRANSFORMATION_START_MS + 500 + 50 * index;
  const outlineStartMs = strandStartMs + 280;

  return { strandStartMs, outlineStartMs };
};

// The real <img> wordmark (BettyWelcomeOverlay's StyledWordmark) starts
// fading in at the same moment, right on top of this same spot: crossfade
// this traced layer out over it, so it doesn't linger, filled, through the
// dimming and iris beats.
const FADE_OUT_DELAY_MS = BETTY_WELCOME_TRANSFORMATION_START_MS + 1450;

const StyledContainer = styled.div`
  left: 50%;
  position: absolute;
  top: 44%;
  transform: translate(-50%, -50%);
  width: 220px;

  // The crouch + jump that hands off from BettyWelcomeFigure (same transform
  // shape as its own jump keyframe), then holds while the strands draw.
  animation:
    bettyTransformSettle 0.3s ${EASE_OUT}
      ${BETTY_WELCOME_TRANSFORMATION_START_MS}ms both,
    bettyTransformFadeOut 500ms linear ${FADE_OUT_DELAY_MS}ms forwards;

  @keyframes bettyTransformSettle {
    from {
      transform: translate(-50%, -50%) translateY(-16px) scale(1.12);
    }
    to {
      transform: translate(-50%, -50%);
    }
  }

  @keyframes bettyTransformFadeOut {
    to {
      opacity: 0;
    }
  }
`;

const StyledStrand = styled.path`
  --betty-strand-delay: 0ms;

  animation: bettyStrandDraw 430ms ${EASE_IN_OUT} var(--betty-strand-delay) both;
  fill: none;
  stroke: ${BRAND_COLORS.terracotta};
  stroke-linecap: round;
  stroke-width: 10;

  @keyframes bettyStrandDraw {
    0% {
      opacity: 0;
      stroke-dashoffset: 1;
    }
    15% {
      opacity: 1;
    }
    65% {
      opacity: 1;
      stroke-dashoffset: 0;
    }
    100% {
      opacity: 0;
      stroke-dashoffset: 0;
    }
  }
`;

const StyledGlyphOutline = styled.path`
  --betty-outline-fade-delay: 0ms;
  --betty-outline-trace-delay: 0ms;

  animation:
    bettyGlyphOutlineTrace 380ms ${EASE_IN_OUT} var(--betty-outline-trace-delay)
      both,
    bettyGlyphOutlineFade 150ms linear var(--betty-outline-fade-delay) forwards;
  fill: none;
  stroke: ${BRAND_COLORS.terracotta};
  stroke-linejoin: round;
  stroke-width: 3;

  @keyframes bettyGlyphOutlineTrace {
    from {
      opacity: 1;
      stroke-dashoffset: 1;
    }
    to {
      opacity: 1;
      stroke-dashoffset: 0;
    }
  }

  @keyframes bettyGlyphOutlineFade {
    to {
      opacity: 0;
    }
  }
`;

const StyledGlyphFill = styled.path`
  --betty-fill-delay: 0ms;

  animation: bettyGlyphFillIn 240ms ${EASE_OUT} var(--betty-fill-delay) forwards;
  fill: ${BRAND_COLORS.charcoal};
  opacity: 0;

  @keyframes bettyGlyphFillIn {
    to {
      opacity: 1;
    }
  }
`;

const DOT_LAND_DELAY_MS = BETTY_WELCOME_TRANSFORMATION_START_MS + 700;
const DOT_LAND_FADE_OUT_DELAY_MS = BETTY_WELCOME_TRANSFORMATION_START_MS + 1450;

const StyledLandingDot = styled.circle`
  animation:
    bettyDotLand 450ms ${EASE_OUT} ${DOT_LAND_DELAY_MS}ms both,
    bettyDotLandFadeOut 150ms linear ${DOT_LAND_FADE_OUT_DELAY_MS}ms forwards;
  fill: ${BRAND_COLORS.terracotta};
  opacity: 0;
  transform-origin: ${ORIGIN[0]}px ${ORIGIN[1]}px;

  @keyframes bettyDotLand {
    from {
      opacity: 0;
      transform: translate(0, 0) scale(1.3);
    }
    to {
      opacity: 1;
      transform: translate(
          ${BETTY_WORDMARK_DOT.cx - ORIGIN[0]}px,
          ${BETTY_WORDMARK_DOT.cy - ORIGIN[1]}px
        )
        scale(1);
    }
  }

  @keyframes bettyDotLandFadeOut {
    to {
      opacity: 0;
    }
  }
`;

// The transformation beat: the figure's thread unravels into four strands
// that trace and fill the real "b · e · tt · y" glyphs (copied byte for byte
// from the approved wordmark, never redrawn — bettyWordmarkGlyphs.ts), the
// dot lands last as the final period. The approved <img> wordmark itself
// (BettyWelcomeOverlay's StyledWordmark) fades in on top of this, timed to
// land right as the last glyph finishes filling.
export const BettyWelcomeTransformation = () => (
  <StyledContainer>
    <svg
      viewBox={BETTY_WORDMARK_VIEW_BOX.join(' ')}
      width="100%"
      style={{
        aspectRatio: doNotTranslate(
          `${BETTY_WORDMARK_VIEW_BOX[2]} / ${BETTY_WORDMARK_VIEW_BOX[3]}`,
        ),
        display: 'block',
        overflow: 'visible',
      }}
    >
      {BETTY_WORDMARK_GLYPHS.map((glyph, index) => {
        const { strandStartMs, outlineStartMs } = glyphTimingMs(index);

        return (
          <g key={glyph.id}>
            <StyledStrand
              pathLength="1"
              strokeDasharray="1"
              strokeDashoffset="1"
              d={strandPath(glyph.start)}
              style={
                {
                  '--betty-strand-delay': doNotTranslate(`${strandStartMs}ms`),
                } as CSSProperties
              }
            />
            <StyledGlyphOutline
              pathLength="1"
              strokeDasharray="1"
              strokeDashoffset="1"
              d={glyph.d}
              style={
                {
                  '--betty-outline-trace-delay': doNotTranslate(
                    `${outlineStartMs}ms`,
                  ),
                  '--betty-outline-fade-delay': doNotTranslate(
                    `${outlineStartMs + 380}ms`,
                  ),
                } as CSSProperties
              }
            />
            <StyledGlyphFill
              d={glyph.d}
              style={
                {
                  '--betty-fill-delay': doNotTranslate(
                    `${outlineStartMs + 200}ms`,
                  ),
                } as CSSProperties
              }
            />
          </g>
        );
      })}
      <StyledLandingDot
        cx={ORIGIN[0]}
        cy={ORIGIN[1]}
        r={BETTY_WORDMARK_DOT.r}
      />
    </svg>
  </StyledContainer>
);
