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
import { useEffect, useState } from 'react';
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
  background: ${BRAND_COLORS.ivory};
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
  height: 100%;
  position: relative;
  width: 100%;
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
  margin-left: -230px;
  margin-top: -170px;
  padding: 32px 40px;
  position: absolute;
  top: 50%;
  width: 460px;

  @keyframes bettyCardIn {
    from {
      opacity: 0;
      transform: translateY(12px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
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
    bettyFadeOut 0.3s ${EASE_OUT} ${TRANSFORMATION_START_MS}ms forwards;
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
`;

const StyledThreadDot = styled.span`
  animation:
    bettyDotHop ${BETTY_WELCOME_SCENE_DURATIONS_MS.figure}ms ${EASE_OUT}
      ${FIGURE_START_MS}ms forwards,
    bettyFadeOut 0.3s ${EASE_OUT} ${TRANSFORMATION_START_MS}ms forwards;
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
`;

const StyledWordmark = styled.img`
  animation:
    bettyWordmarkIn 0.8s ${EASE_OUT} ${TRANSFORMATION_START_MS + 400}ms forwards,
    bettyFadeOut 0.4s ${EASE_OUT} ${DIM_START_MS}ms forwards;
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
`;

const StyledGreeting = styled.p`
  animation:
    bettyGreetingIn 0.5s ${EASE_OUT} ${WELCOME_START_MS}ms forwards,
    bettyFadeOut 0.4s ${EASE_OUT} ${DIM_START_MS}ms forwards;
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
`;

const StyledSignature = styled.img`
  animation:
    bettyFadeIn 0.6s ${EASE_OUT} ${WELCOME_START_MS + 400}ms forwards,
    bettyFadeOut 0.4s ${EASE_OUT} ${DIM_START_MS}ms forwards;
  left: 50%;
  opacity: 0;
  position: absolute;
  top: 68%;
  transform: translate(-50%, 0);
  width: 180px;
`;

const StyledDim = styled.div`
  animation: bettyFadeIn ${BETTY_WELCOME_SCENE_DURATIONS_MS.dim}ms
    ${EASE_IN_OUT} ${DIM_START_MS}ms forwards;
  background: ${BRAND_COLORS.charcoal};
  inset: 0;
  opacity: 0;
  position: absolute;

  @keyframes bettyFadeIn {
    to {
      opacity: 1;
    }
  }
`;

const StyledIrisMaskHost = styled.svg`
  height: 0;
  overflow: hidden;
  position: absolute;
  width: 0;
`;

const StyledIrisHole = styled.circle`
  fill: black;
  r: 0;
  transition: r 0.8s ${EASE_IN_OUT};

  &.is-open {
    r: 141.5vmax;
  }
`;

const StyledIrisRing = styled.circle`
  fill: none;
  r: 0;
  stroke: ${BRAND_COLORS.terracotta};
  stroke-width: 7px;
  transition:
    r 0.8s ${EASE_IN_OUT},
    stroke-width 0.8s ${EASE_IN_OUT};

  &.is-open {
    r: 141.5vmax;
    stroke-width: 0;
  }
`;

const StyledIrisMasked = styled.div`
  background: ${BRAND_COLORS.charcoal};
  height: 100%;
  mask: url(#betty-iris-mask);
  width: 100%;
`;

const StyledIrisRingLayer = styled.svg`
  height: 100%;
  left: 0;
  pointer-events: none;
  position: absolute;
  top: 0;
  width: 100%;
`;

const StyledReducedLayer = styled.div`
  align-items: center;
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
          <StyledReducedLayer
            style={{
              animation: doNotTranslate(
                `bettyReducedFadeIn 0.2s linear forwards, bettyReducedFadeOut 0.2s linear ${REDUCED_CARD_HOLD_MS}ms forwards`,
              ),
            }}
          >
            <StyledReducedCard>{cardContent}</StyledReducedCard>
          </StyledReducedLayer>
          <StyledReducedLayer
            style={{
              animation: doNotTranslate(
                `bettyReducedFadeIn 0.2s linear ${REDUCED_WELCOME_START_MS}ms forwards, bettyReducedFadeOut 0.2s linear ${REDUCED_WELCOME_HOLD_MS}ms forwards`,
              ),
            }}
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
          <StyledReducedLayer
            style={{
              animation: doNotTranslate(
                `bettyReducedFadeIn 0.3s linear ${REDUCED_DARK_START_MS}ms forwards`,
              ),
              background: BRAND_COLORS.charcoal,
            }}
          />
        </StyledScene>
      ) : (
        <StyledScene aria-hidden="true">
          <StyledCard>
            <StyledStamp src={stampSrc} alt="" aria-hidden="true" />
            {cardContent}
          </StyledCard>
          <StyledThread src={threadSrc} alt="" aria-hidden="true" />
          <StyledThreadDot />
          <StyledWordmark src={wordmarkSrc} alt={wordmarkAlt} />
          <StyledGreeting>{greeting}</StyledGreeting>
          <StyledSignature src={signatureSrc} alt="" aria-hidden="true" />
          <StyledDim>
            <StyledIrisMaskHost>
              <defs>
                <mask id="betty-iris-mask">
                  <rect width="100%" height="100%" fill="white" />
                  <StyledIrisHole
                    className={isIrisOpen ? 'is-open' : undefined}
                    cx="50%"
                    cy="50%"
                  />
                </mask>
              </defs>
            </StyledIrisMaskHost>
            <StyledIrisMasked />
            <StyledIrisRingLayer>
              <StyledIrisRing
                className={isIrisOpen ? 'is-open' : undefined}
                cx="50%"
                cy="50%"
              />
            </StyledIrisRingLayer>
          </StyledDim>
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
