import { currentUserState } from '@/auth/states/currentUserState';
import { focusFirstInteractiveDashboardElement } from '@/onboarding/components/BettyWelcomeOverlay/focusFirstInteractiveDashboardElement';
import {
  BETTY_WELCOME_DURATION_MS,
  BETTY_WELCOME_IRIS_OPEN_AT_MS,
  BETTY_WELCOME_REDUCED_MOTION_DURATION_MS,
  BETTY_WELCOME_SCENE_DURATIONS_MS,
} from '@/onboarding/components/BettyWelcomeOverlay/bettyWelcomeTimeline';
import { isBettyWelcomeVisibleState } from '@/onboarding/states/isBettyWelcomeVisibleState';
import { RootStackingContextZIndices } from '@/ui/layout/constants/RootStackingContextZIndices';
import { useAtomStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomStateValue';
import { useSetAtomState } from '@/ui/utilities/state/jotai/hooks/useSetAtomState';
import { styled } from '@linaria/react';
import { useLingui } from '@lingui/react/macro';
import { type CSSProperties, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Key } from 'ts-key-enum';
import { BRAND_COLORS } from 'twenty-shared/constants';
import { doNotTranslate } from 'twenty-shared/i18n';
import { isDefined } from 'twenty-shared/utils';
import { VisuallyHidden } from 'twenty-ui/primitives/accessibility';
import { Button } from 'twenty-ui/primitives/input';
import { themeCssVariables } from 'twenty-ui/theme';
import { useMediaQuery } from 'twenty-ui/utilities';

const SERIF = doNotTranslate('Fraunces, Georgia, serif');
const SANS = doNotTranslate('"Source Sans 3", system-ui, Arial, sans-serif');
const EASE_OUT = doNotTranslate('cubic-bezier(.2,.7,.2,1)');
const EASE_IN_OUT = doNotTranslate('cubic-bezier(.65,0,.35,1)');

// Cumulative scene starts (ms), from BETTY_WELCOME_SCENE_DURATIONS_MS.
const READY_START_MS = 0;
const THREAD_START_MS = READY_START_MS + BETTY_WELCOME_SCENE_DURATIONS_MS.ready;
const FIGURE_START_MS =
  THREAD_START_MS + BETTY_WELCOME_SCENE_DURATIONS_MS.thread;
const TRANSFORMATION_START_MS =
  FIGURE_START_MS + BETTY_WELCOME_SCENE_DURATIONS_MS.figure;
const WELCOME_START_MS =
  TRANSFORMATION_START_MS + BETTY_WELCOME_SCENE_DURATIONS_MS.transformation;
const DIM_START_MS =
  WELCOME_START_MS + BETTY_WELCOME_SCENE_DURATIONS_MS.welcome;

const REDUCED_CARD_HOLD_MS = BETTY_WELCOME_REDUCED_MOTION_DURATION_MS * 0.24;
const REDUCED_WELCOME_START_MS =
  BETTY_WELCOME_REDUCED_MOTION_DURATION_MS * 0.32;
const REDUCED_WELCOME_HOLD_MS = BETTY_WELCOME_REDUCED_MOTION_DURATION_MS * 0.64;
const REDUCED_DARK_START_MS = BETTY_WELCOME_REDUCED_MOTION_DURATION_MS * 0.64;

const splitTitleForUnderline = (title: string) => {
  const match = title.match(/^(.*\s)(\S+?)([.!?]?)$/);

  if (!isDefined(match)) {
    return { prefix: '', underlined: title, suffix: '' };
  }

  const [, prefix, underlined, suffix] = match;

  return { prefix, underlined, suffix };
};

const StyledRoot = styled.div`
  align-items: center;
  bottom: 0;
  display: flex;
  justify-content: center;
  left: 0;
  overflow: hidden;
  position: fixed;
  right: 0;
  top: 0;
  z-index: ${RootStackingContextZIndices.BettyWelcomeOverlay};
`;

const StyledSkipButtonContainer = styled.div`
  position: absolute;
  right: 24px;
  top: 24px;
  z-index: 2;
`;

const StyledScene = styled.div`
  --betty-iris-radius: 0px;

  height: 100%;
  position: relative;
  transition: --betty-iris-radius 0.8s ${EASE_IN_OUT};
  width: 100%;

  &.is-open {
    --betty-iris-radius: 3000px;
  }
`;

const StyledCard = styled.div`
  animation:
    bettyCardIn 0.4s ${EASE_OUT} both,
    bettyFadeOut 0.3s ${EASE_OUT} ${THREAD_START_MS - 100}ms forwards;
  background: ${BRAND_COLORS.paperWhite};
  border: 1px solid ${BRAND_COLORS.beige};
  border-radius: 18px;
  box-shadow: ${themeCssVariables.boxShadow.strong};
  left: 50%;
  padding: 32px 40px;
  position: absolute;
  top: 50%;
  width: min(460px, 90vw);

  @keyframes bettyCardIn {
    from {
      opacity: 0;
      transform: translate(-50%, calc(-50% + 12px));
    }
    to {
      opacity: 1;
      transform: translate(-50%, -50%);
    }
  }

  @keyframes bettyFadeOut {
    to {
      opacity: 0;
    }
  }
`;

const StyledEyebrow = styled.p`
  color: ${BRAND_COLORS.mutedText};
  font: 600 13px/1.2 ${SANS};
  letter-spacing: 0.12em;
  margin: 0 0 12px;
  text-transform: uppercase;
`;

const StyledTitle = styled.h2`
  color: ${BRAND_COLORS.charcoal};
  font: 400 34px/1.1 ${SERIF};
  margin: 0 0 20px;
`;

const StyledTitleUnderline = styled.span`
  box-shadow: inset 0 -0.14em 0 ${BRAND_COLORS.terracotta};
`;

const StyledRows = styled.ul`
  display: flex;
  flex-direction: column;
  gap: 10px;
  list-style: none;
  margin: 0;
  padding: 0;
`;

const StyledRow = styled.li`
  align-items: center;
  border-top: 1px solid ${BRAND_COLORS.beige};
  color: ${BRAND_COLORS.charcoal};
  display: flex;
  font: 500 16px/1.2 ${SANS};
  gap: 10px;
  justify-content: space-between;
  padding-top: 10px;
`;

const StyledCheck = styled.svg`
  flex-shrink: 0;
  height: 14px;
  width: 14px;
`;

const StyledStamp = styled.img`
  opacity: 0.9;
  position: absolute;
  right: 24px;
  top: 20px;
  transform: rotate(-8deg);
  width: 96px;
`;

const StyledThread = styled.img`
  animation:
    bettyThreadIn ${BETTY_WELCOME_SCENE_DURATIONS_MS.thread}ms ${EASE_IN_OUT}
      ${THREAD_START_MS}ms forwards,
    bettyThreadOut 0.3s ${EASE_OUT} ${TRANSFORMATION_START_MS}ms forwards;
  bottom: 18%;
  left: 50%;
  opacity: 0;
  position: absolute;
  transform: translateX(-50%) scaleX(0.3);
  transform-origin: left center;
  width: 220px;

  @keyframes bettyThreadIn {
    from {
      opacity: 0;
      transform: translateX(-50%) scaleX(0.3);
    }
    to {
      opacity: 1;
      transform: translateX(-50%) scaleX(1);
    }
  }

  @keyframes bettyThreadOut {
    to {
      opacity: 0;
    }
  }
`;

const StyledThreadDot = styled.span`
  animation:
    bettyDotHop ${BETTY_WELCOME_SCENE_DURATIONS_MS.figure}ms ${EASE_OUT}
      ${FIGURE_START_MS}ms forwards,
    bettyDotOut 0.3s ${EASE_OUT} ${TRANSFORMATION_START_MS}ms forwards;
  background: ${BRAND_COLORS.terracotta};
  border-radius: 50%;
  bottom: calc(18% + 10px);
  height: 16px;
  left: 50%;
  opacity: 0;
  position: absolute;
  width: 16px;

  @keyframes bettyDotHop {
    0% {
      opacity: 0;
      transform: translate(-50%, 0);
    }
    8% {
      opacity: 1;
    }
    25% {
      transform: translate(-80px, -22px);
    }
    50% {
      transform: translate(-40px, 0);
    }
    75% {
      transform: translate(0, -22px);
    }
    92% {
      opacity: 1;
      transform: translate(40px, 0);
    }
    100% {
      opacity: 1;
      transform: translate(40px, 0);
    }
  }

  @keyframes bettyDotOut {
    to {
      opacity: 0;
    }
  }
`;

const StyledWordmark = styled.img`
  animation:
    bettyWordmarkIn 0.8s ${EASE_OUT} ${TRANSFORMATION_START_MS + 400}ms forwards,
    bettyWordmarkOut 0.4s ${EASE_OUT} ${DIM_START_MS}ms forwards;
  left: 50%;
  opacity: 0;
  position: absolute;
  top: 44%;
  transform: translate(-50%, -50%) scale(0.92);
  width: 220px;

  @keyframes bettyWordmarkIn {
    to {
      opacity: 1;
      transform: translate(-50%, -50%) scale(1);
    }
  }

  @keyframes bettyWordmarkOut {
    to {
      opacity: 0;
    }
  }
`;

const StyledGreeting = styled.p`
  animation:
    bettyGreetingIn 0.5s ${EASE_OUT} ${WELCOME_START_MS}ms forwards,
    bettyGreetingOut 0.4s ${EASE_OUT} ${DIM_START_MS}ms forwards;
  color: ${BRAND_COLORS.charcoal};
  font: 400 30px/1.2 ${SERIF};
  left: 50%;
  margin: 0;
  opacity: 0;
  position: absolute;
  text-align: center;
  top: 58%;
  transform: translate(-50%, 10px);
  width: 90vw;

  @keyframes bettyGreetingIn {
    to {
      opacity: 1;
      transform: translate(-50%, 0);
    }
  }

  @keyframes bettyGreetingOut {
    to {
      opacity: 0;
    }
  }
`;

const StyledSignature = styled.img`
  animation:
    bettySignatureIn 0.6s ${EASE_OUT} ${WELCOME_START_MS + 400}ms forwards,
    bettySignatureOut 0.4s ${EASE_OUT} ${DIM_START_MS}ms forwards;
  left: 50%;
  opacity: 0;
  position: absolute;
  top: 68%;
  transform: translate(-50%, 0);
  width: 180px;

  @keyframes bettySignatureIn {
    to {
      opacity: 1;
    }
  }

  @keyframes bettySignatureOut {
    to {
      opacity: 0;
    }
  }
`;

// The base layer for the whole layer (ivory, then charcoal once dimmed). Its
// mask-image is a radial gradient whose transparent circle (the "hole") grows
// via the --betty-iris-radius custom property declared on StyledScene (see
// its @property registration below): registering it as a <length> is what
// lets the browser interpolate it smoothly, which in turn drives a smooth
// mask-image (and, for StyledIrisRing below, SVG r) recomputation each frame.
const StyledBackdrop = styled.div`
  animation: bettyDimIn ${BETTY_WELCOME_SCENE_DURATIONS_MS.dim}ms ${EASE_IN_OUT}
    ${DIM_START_MS}ms forwards;
  background: ${BRAND_COLORS.ivory};
  inset: 0;
  mask-image: radial-gradient(
    circle at center,
    transparent var(--betty-iris-radius),
    black calc(var(--betty-iris-radius) + 1px)
  );
  position: absolute;

  @keyframes bettyDimIn {
    to {
      background: ${BRAND_COLORS.charcoal};
    }
  }
`;

const StyledIrisRingLayer = styled.svg`
  height: 100%;
  left: 0;
  pointer-events: none;
  position: absolute;
  top: 0;
  width: 100%;
`;

const StyledIrisRing = styled.circle`
  fill: none;
  r: var(--betty-iris-radius);
  stroke: ${BRAND_COLORS.terracotta};
  stroke-width: calc(7px - var(--betty-iris-radius) * 7px / 3000px);
`;

// Always opaque, so the real page behind the layer never bleeds through
// between the reduced-motion phases' fades (which only animate what's on
// top of it).
const StyledReducedBackdrop = styled.div`
  animation: bettyReducedDimIn 0.3s linear ${REDUCED_DARK_START_MS}ms forwards;
  background: ${BRAND_COLORS.ivory};
  inset: 0;
  position: absolute;

  @keyframes bettyReducedDimIn {
    to {
      background: ${BRAND_COLORS.charcoal};
    }
  }
`;

// The per-instance fade-in/out delays are passed as CSS custom properties
// (via inline style) rather than as an inline "animation" shorthand: linaria
// only rewrites keyframe names it sees inside this template, so a keyframe
// name written into a runtime style string would reference the wrong,
// unscoped name and never match.
const StyledReducedLayer = styled.div`
  --reduced-fade-in-delay: 0ms;
  --reduced-fade-out-delay: 999999ms;

  align-items: center;
  animation:
    bettyReducedFadeIn 0.2s linear var(--reduced-fade-in-delay) forwards,
    bettyReducedFadeOut 0.2s linear var(--reduced-fade-out-delay) forwards;
  display: flex;
  flex-direction: column;
  gap: 16px;
  inset: 0;
  justify-content: center;
  opacity: 0;
  position: absolute;

  @keyframes bettyReducedFadeIn {
    to {
      opacity: 1;
    }
  }

  @keyframes bettyReducedFadeOut {
    to {
      opacity: 0;
    }
  }
`;

const StyledReducedCard = styled.div`
  background: ${BRAND_COLORS.paperWhite};
  border: 1px solid ${BRAND_COLORS.beige};
  border-radius: 18px;
  padding: 32px 40px;
  width: 340px;
`;

type BettyWelcomeContentProps = {
  firstName: string | null | undefined;
  lang: 'es' | 'en';
  prefersReducedMotion: boolean;
  onDismiss: () => void;
};

const BettyWelcomeContent = ({
  firstName,
  lang,
  prefersReducedMotion,
  onDismiss,
}: BettyWelcomeContentProps) => {
  const { t } = useLingui();
  const [isIrisOpen, setIsIrisOpen] = useState(false);

  useEffect(() => {
    if (prefersReducedMotion) {
      const timeoutId = setTimeout(
        onDismiss,
        BETTY_WELCOME_REDUCED_MOTION_DURATION_MS,
      );
      return () => clearTimeout(timeoutId);
    }

    const irisTimeoutId = setTimeout(
      () => setIsIrisOpen(true),
      BETTY_WELCOME_IRIS_OPEN_AT_MS,
    );

    const dismissTimeoutId = setTimeout(onDismiss, BETTY_WELCOME_DURATION_MS);

    return () => {
      clearTimeout(irisTimeoutId);
      clearTimeout(dismissTimeoutId);
    };
  }, [prefersReducedMotion, onDismiss]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === Key.Escape) {
        onDismiss();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onDismiss]);

  useEffect(() => {
    return () => {
      focusFirstInteractiveDashboardElement();
    };
  }, []);

  const eyebrow = t`Initial setup · 3 of 3`;
  const titleText = t`Your space is ready.`;
  const { prefix, underlined, suffix } = splitTitleForUnderline(titleText);
  const rows = [
    t`Account created`,
    t`Sources authorized`,
    t`Connect your assistant`,
  ];
  const greeting =
    isDefined(firstName) && firstName.length > 0
      ? t`Welcome, ${firstName}.`
      : t`Welcome.`;
  const announcement = `${titleText} ${greeting}`;

  const wordmarkSrc = doNotTranslate('/brand/logo/betty-wordmark-primary.svg');
  const stampSrc = doNotTranslate('/brand/ornament/betty-matasellos.svg');
  const threadSrc = doNotTranslate('/brand/ornament/betty-hilo-corto.svg');
  const signatureSrc = doNotTranslate(
    lang === 'es'
      ? '/brand/ornament/betty-firma-relaciones.svg'
      : '/brand/ornament/betty-firma-relationships-en.svg',
  );
  const wordmarkAlt = doNotTranslate('betty.');

  const cardContent = (
    <>
      <StyledEyebrow>{eyebrow}</StyledEyebrow>
      <StyledTitle>
        {prefix}
        <StyledTitleUnderline>{underlined}</StyledTitleUnderline>
        {suffix}
      </StyledTitle>
      <StyledRows>
        {rows.map((row) => (
          <StyledRow key={row}>
            {row}
            <StyledCheck viewBox="0 0 16 16" aria-hidden="true">
              <path
                d="M3 8.5l3 3 7-7"
                fill="none"
                stroke={BRAND_COLORS.terracottaInk}
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </StyledCheck>
          </StyledRow>
        ))}
      </StyledRows>
    </>
  );

  return (
    <StyledRoot>
      {/* Registers --betty-iris-radius as an animatable <length>, so the
          transition declared on it in StyledScene also animates the
          mask-image and SVG r values that reference it via var(). */}
      <style>
        {doNotTranslate(
          "@property --betty-iris-radius { syntax: '<length>'; inherits: true; initial-value: 0px; }",
        )}
      </style>
      <StyledSkipButtonContainer>
        <Button variant="outline" onClick={onDismiss}>
          {t`Skip animation`}
        </Button>
      </StyledSkipButtonContainer>
      <VisuallyHidden role="status" aria-live="polite">
        {announcement}
      </VisuallyHidden>
      {prefersReducedMotion ? (
        <StyledScene aria-hidden="true">
          <StyledReducedBackdrop />
          <StyledReducedLayer
            style={
              {
                '--reduced-fade-out-delay': doNotTranslate(
                  `${REDUCED_CARD_HOLD_MS}ms`,
                ),
              } as CSSProperties
            }
          >
            <StyledReducedCard>{cardContent}</StyledReducedCard>
          </StyledReducedLayer>
          <StyledReducedLayer
            style={
              {
                '--reduced-fade-in-delay': doNotTranslate(
                  `${REDUCED_WELCOME_START_MS}ms`,
                ),
                '--reduced-fade-out-delay': doNotTranslate(
                  `${REDUCED_WELCOME_HOLD_MS}ms`,
                ),
              } as CSSProperties
            }
          >
            <img src={wordmarkSrc} alt={wordmarkAlt} width={180} />
            <StyledGreeting
              style={{
                animation: doNotTranslate('none'),
                opacity: 1,
                position: 'static',
                transform: doNotTranslate('none'),
                width: doNotTranslate('auto'),
              }}
            >
              {greeting}
            </StyledGreeting>
          </StyledReducedLayer>
        </StyledScene>
      ) : (
        <StyledScene
          aria-hidden="true"
          className={isIrisOpen ? 'is-open' : undefined}
        >
          <StyledBackdrop />
          <StyledCard>
            <StyledStamp src={stampSrc} alt="" aria-hidden="true" />
            {cardContent}
          </StyledCard>
          <StyledThread src={threadSrc} alt="" aria-hidden="true" />
          <StyledThreadDot />
          <StyledWordmark src={wordmarkSrc} alt={wordmarkAlt} />
          <StyledGreeting>{greeting}</StyledGreeting>
          <StyledSignature src={signatureSrc} alt="" aria-hidden="true" />
          <StyledIrisRingLayer>
            <StyledIrisRing cx="50%" cy="50%" />
          </StyledIrisRingLayer>
        </StyledScene>
      )}
    </StyledRoot>
  );
};

export const BettyWelcomeOverlay = () => {
  const { i18n } = useLingui();
  const isBettyWelcomeVisible = useAtomStateValue(isBettyWelcomeVisibleState);
  const setIsBettyWelcomeVisible = useSetAtomState(isBettyWelcomeVisibleState);
  const currentUser = useAtomStateValue(currentUserState);
  const prefersReducedMotion = useMediaQuery(
    doNotTranslate('(prefers-reduced-motion: reduce)'),
  );

  if (!isBettyWelcomeVisible) {
    return null;
  }

  const lang = i18n.locale.startsWith('es') ? 'es' : 'en';

  return createPortal(
    <BettyWelcomeContent
      firstName={currentUser?.firstName}
      lang={lang}
      prefersReducedMotion={prefersReducedMotion}
      onDismiss={() => setIsBettyWelcomeVisible(false)}
    />,
    document.body,
  );
};
