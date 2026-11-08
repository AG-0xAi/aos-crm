import { doNotTranslate } from 'twenty-shared/i18n';

const FOCUSABLE_SELECTOR = doNotTranslate(
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
);

const isRendered = (element: HTMLElement) => {
  const style = window.getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden';
};

// Called after the overlay has unmounted, so its own elements are no longer in the DOM.
// Uses computed style rather than offsetParent: the latter is always null under jsdom,
// which has no layout engine, and would make this a no-op in tests.
export const focusFirstInteractiveDashboardElement = () => {
  const candidates = document.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);

  for (const candidate of candidates) {
    if (isRendered(candidate)) {
      candidate.focus();
      return;
    }
  }
};
