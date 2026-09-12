import '@testing-library/jest-dom/vitest';

/**
 * jsdom implements neither of these, and both are used on the countdown screen.
 * Stubbing them here keeps the component tests focused on behaviour rather than
 * on environment paperwork.
 */
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

if (!window.scrollTo) {
  window.scrollTo = (() => {}) as unknown as typeof window.scrollTo;
}
