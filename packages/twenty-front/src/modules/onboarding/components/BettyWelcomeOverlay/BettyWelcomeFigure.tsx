import {
  BETTY_WELCOME_FIGURE_START_MS,
  BETTY_WELCOME_TRANSFORMATION_START_MS,
} from '@/onboarding/components/BettyWelcomeOverlay/bettyWelcomeTimeline';
import { styled } from '@linaria/react';
import { doNotTranslate } from 'twenty-shared/i18n';
import { BRAND_COLORS } from 'twenty-shared/constants';

const EASE_OUT = doNotTranslate('cubic-bezier(.2,.7,.2,1)');
const EASE_IN_OUT = doNotTranslate('cubic-bezier(.65,0,.35,1)');

// Walk cadence: 4 footfalls (2 per leg) over betty-bienvenida-spec.md's
// "Figura" scene, inside its 0.72s-1.72s window (betty-bienvenida.jsx's
// `walk`/`c` phase). Legs and arms swing in opposite phase.
const WALK_START_MS = BETTY_WELCOME_FIGURE_START_MS + 720;
const WALK_DURATION_MS = 1000;
const WAVE_START_MS = WALK_START_MS + WALK_DURATION_MS;
const WAVE_DURATION_MS = 480;
// The whole lifecycle: rise out of the thread, walk, wave, then the crouch +
// jump that hands off into the transformation beat's unravel.
const LIFECYCLE_DURATION_MS =
  BETTY_WELCOME_TRANSFORMATION_START_MS + 300 - BETTY_WELCOME_FIGURE_START_MS;

const risePercent = (420 / LIFECYCLE_DURATION_MS) * 100;
const bobPercents = [750, 920, 1120, 1320, 1520, 1720].map(
  (ms) => (ms / LIFECYCLE_DURATION_MS) * 100,
);
const jumpStartPercent =
  ((BETTY_WELCOME_TRANSFORMATION_START_MS - BETTY_WELCOME_FIGURE_START_MS) /
    LIFECYCLE_DURATION_MS) *
  100;
const jumpPeakPercent =
  ((BETTY_WELCOME_TRANSFORMATION_START_MS -
    BETTY_WELCOME_FIGURE_START_MS +
    110) /
    LIFECYCLE_DURATION_MS) *
  100;

// Only `transform`, `opacity` and SVG strokes animate here (assets/motion/betty-
// bienvenida-spec.md's "Reglas"): the figure is built from static paths whose
// groups rotate around hip/shoulder pivots, never from redrawn `d` values.
const StyledContainer = styled.div`
  bottom: 18%;
  height: 92px;
  left: 50%;
  position: absolute;
  transform: translateX(-50%);
  width: 92px;
`;

const StyledFigureLifecycle = styled.g`
  animation: bettyFigureLifecycle ${LIFECYCLE_DURATION_MS}ms ${EASE_OUT}
    ${BETTY_WELCOME_FIGURE_START_MS}ms both;
  transform-origin: 0px 60px;

  @keyframes bettyFigureLifecycle {
    0% {
      opacity: 0;
      transform: translateY(6px) scaleY(0.4);
    }
    ${risePercent}% {
      opacity: 1;
      transform: translateY(0) scaleY(1);
    }
    ${bobPercents[0]}% {
      transform: translateY(-3px) scaleY(1);
    }
    ${bobPercents[1]}% {
      transform: translateY(2px) scaleY(1);
    }
    ${bobPercents[2]}% {
      transform: translateY(-3px) scaleY(1);
    }
    ${bobPercents[3]}% {
      transform: translateY(2px) scaleY(1);
    }
    ${bobPercents[4]}% {
      transform: translateY(-3px) scaleY(1);
    }
    ${bobPercents[5]}% {
      transform: translateY(0) scaleY(1);
      opacity: 1;
    }
    ${jumpStartPercent}% {
      transform: translateY(0) scaleY(1);
      opacity: 1;
    }
    ${jumpPeakPercent}% {
      transform: translateY(-16px) scaleY(1.12);
      opacity: 1;
    }
    100% {
      transform: translateY(-44px) scaleY(0.6);
      opacity: 0;
    }
  }
`;

const StyledFigureWalk = styled.g`
  animation: bettyFigureWalk ${WALK_DURATION_MS}ms ${EASE_IN_OUT}
    ${WALK_START_MS}ms both;

  @keyframes bettyFigureWalk {
    from {
      transform: translateX(0);
    }
    to {
      transform: translateX(40px);
    }
  }
`;

const StyledLimb = styled.path`
  fill: none;
  stroke: ${BRAND_COLORS.terracotta};
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 5;
`;

const StyledTorso = styled(StyledLimb)`
  stroke-width: 6;
`;

const StyledLegLeft = styled.g`
  animation: bettyFigureLegLeft ${WALK_DURATION_MS}ms ${EASE_IN_OUT}
    ${WALK_START_MS}ms both;
  transform-origin: 0px 55px;

  @keyframes bettyFigureLegLeft {
    0% {
      transform: rotate(-20deg);
    }
    25% {
      transform: rotate(20deg);
    }
    50% {
      transform: rotate(-20deg);
    }
    75% {
      transform: rotate(20deg);
    }
    100% {
      transform: rotate(0deg);
    }
  }
`;

const StyledLegRight = styled.g`
  animation: bettyFigureLegRight ${WALK_DURATION_MS}ms ${EASE_IN_OUT}
    ${WALK_START_MS}ms both;
  transform-origin: 0px 55px;

  @keyframes bettyFigureLegRight {
    0% {
      transform: rotate(20deg);
    }
    25% {
      transform: rotate(-20deg);
    }
    50% {
      transform: rotate(20deg);
    }
    75% {
      transform: rotate(-20deg);
    }
    100% {
      transform: rotate(0deg);
    }
  }
`;

const StyledArmLeft = styled.g`
  animation: bettyFigureArmLeft ${WALK_DURATION_MS}ms ${EASE_IN_OUT}
    ${WALK_START_MS}ms both;
  transform-origin: 0px 22px;

  @keyframes bettyFigureArmLeft {
    0% {
      transform: rotate(20deg);
    }
    25% {
      transform: rotate(-20deg);
    }
    50% {
      transform: rotate(20deg);
    }
    75% {
      transform: rotate(-20deg);
    }
    100% {
      transform: rotate(0deg);
    }
  }
`;

// The waving arm: swings in counter-phase through the walk, then a second,
// later-delayed animation on the same property (transform) takes over once
// active, raising it and wiggling it — the "saluda" beat.
const StyledArmRight = styled.g`
  animation:
    bettyFigureArmRight ${WALK_DURATION_MS}ms ${EASE_IN_OUT} ${WALK_START_MS}ms
      both,
    bettyFigureWave ${WAVE_DURATION_MS}ms ${EASE_OUT} ${WAVE_START_MS}ms
      forwards;
  transform-origin: 0px 22px;

  @keyframes bettyFigureArmRight {
    0% {
      transform: rotate(-20deg);
    }
    25% {
      transform: rotate(20deg);
    }
    50% {
      transform: rotate(-20deg);
    }
    75% {
      transform: rotate(20deg);
    }
    100% {
      transform: rotate(0deg);
    }
  }

  @keyframes bettyFigureWave {
    0% {
      transform: rotate(-110deg);
    }
    40% {
      transform: rotate(-128deg);
    }
    60% {
      transform: rotate(-95deg);
    }
    80% {
      transform: rotate(-128deg);
    }
    100% {
      transform: rotate(-110deg);
    }
  }
`;

const StyledHead = styled.circle`
  fill: ${BRAND_COLORS.terracotta};
`;

// The faceless thread figure: head = the dot (betty-bienvenida-spec.md's
// "Figura" beat), body + limbs = the thread's own stroke. Walks four steps
// (betty-bienvenida.jsx's `walk`/`c` phase) and waves, then hands off to the
// transformation beat (BettyWelcomeTransformation).
export const BettyWelcomeFigure = () => (
  <StyledContainer>
    <svg viewBox="-46 -10 92 110" width="92" height="110" overflow="visible">
      <StyledFigureLifecycle>
        <StyledFigureWalk>
          <StyledTorso d="M0 7Q4 32 0 55" />
          <StyledLegLeft>
            <StyledLimb d="M0 55Q-7 78 -11 98" />
          </StyledLegLeft>
          <StyledLegRight>
            <StyledLimb d="M0 55Q7 78 11 98" />
          </StyledLegRight>
          <StyledArmLeft>
            <StyledLimb d="M0 22Q-15 34 -23 48" />
          </StyledArmLeft>
          <StyledArmRight>
            <StyledLimb d="M0 22Q15 34 23 48" />
          </StyledArmRight>
          <StyledHead cx="0" cy="0" r="8" />
        </StyledFigureWalk>
      </StyledFigureLifecycle>
    </svg>
  </StyledContainer>
);
