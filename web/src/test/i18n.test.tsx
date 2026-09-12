import { describe, expect, test, beforeEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { I18nProvider, LOCALES, useI18n, useT } from '../i18n';
import { currentLocale } from '../i18n/locales';
import type { Bundle } from '../i18n/sq';
import { sq } from '../i18n/sq';
import { en } from '../i18n/en';
import { el } from '../i18n/el';
import { ro } from '../i18n/ro';
import { it } from '../i18n/it';

/** Albanian is the reference; every other bundle is checked against it. */
const TRANSLATIONS: ReadonlyArray<readonly [string, Bundle]> = [
  ['en', en],
  ['el', el],
  ['ro', ro],
  ['it', it],
];

function Probe() {
  const t = useT();
  const { locale, setLocale } = useI18n();
  return (
    <div>
      <span data-testid="locale">{locale}</span>
      <span data-testid="departed">{t('departed')}</span>
      <span data-testid="interpolated">{t('peopleCount', { count: 4 })}</span>
      <button type="button" onClick={() => setLocale('en')}>
        switch
      </button>
    </div>
  );
}

describe('localization', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test('defaults to Albanian even when the browser asks for English', () => {
    // The group is Albanian; their phones frequently are not.
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('en-GB');
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByTestId('locale')).toHaveTextContent('sq');
    expect(screen.getByTestId('departed')).toHaveTextContent('U nisëm për Piqeras!');
  });

  test('interpolates named variables', () => {
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByTestId('interpolated')).toHaveTextContent('4 veta');
  });

  test('switching to English changes every string and is remembered', () => {
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    act(() => {
      screen.getByRole('button', { name: 'switch' }).click();
    });
    expect(screen.getByTestId('locale')).toHaveTextContent('en');
    expect(screen.getByTestId('departed')).toHaveTextContent('We left for Piqeras!');
    expect(localStorage.getItem('piqeras.locale')).toBe('en');
  });

  test('a stored preference survives a reload', () => {
    localStorage.setItem('piqeras.locale', 'en');
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByTestId('locale')).toHaveTextContent('en');
  });

  test('the document language follows the interface on first paint', () => {
    // Not just metadata: `text-transform: uppercase` is language-aware, and
    // only under lang="el" does the browser drop the accents that Greek
    // all-caps must not carry. Setting this only on switch left a returning
    // Greek reader looking at "ΚΑΛΏΣ ΉΡΘΕΣ".
    localStorage.setItem('piqeras.locale', 'el');
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    expect(document.documentElement.lang).toBe('el');
  });

  test('every bundle covers every Albanian key', () => {
    // TypeScript enforces this at build time; this asserts it at runtime too,
    // so a bad merge cannot ship a half-translated UI.
    for (const [name, bundle] of TRANSLATIONS) {
      expect(Object.keys(bundle).sort(), name + ' keys').toEqual(Object.keys(sq).sort());
    }
  });

  test('no translation is left empty', () => {
    for (const [name, bundle] of [['sq', sq as Bundle] as const, ...TRANSLATIONS]) {
      for (const [key, value] of Object.entries(bundle)) {
        expect(value.trim(), name + '.' + key).not.toBe('');
      }
    }
  });

  test('placeholders match the Albanian bundle in every language', () => {
    // A dropped {name} or {count} reads as a sentence with a hole in it, and
    // TypeScript cannot see inside a string to catch it.
    const placeholders = (value: string) => (value.match(/\{(\w+)\}/g) ?? []).sort();
    for (const [name, bundle] of TRANSLATIONS) {
      for (const key of Object.keys(sq) as Array<keyof typeof sq>) {
        expect(placeholders(bundle[key]), name + ' placeholders for "' + key + '"').toEqual(
          placeholders(sq[key]),
        );
      }
    }
  });

  test('every offered language has a bundle, and every bundle is offered', () => {
    // The picker and the bundle map are separate lists; this is what stops one
    // from gaining a language the other does not have.
    expect(LOCALES.map((l) => l.code).sort()).toEqual(
      ['sq', ...TRANSLATIONS.map(([name]) => name)].sort(),
    );
    for (const { label } of LOCALES) expect(label.trim()).not.toBe('');
  });

  test('an unknown stored locale falls back to Albanian', () => {
    // A code left over from an older build, or hand-edited storage.
    localStorage.setItem('piqeras.locale', 'de');
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByTestId('locale')).toHaveTextContent('sq');
  });
});

describe('the language the server is told about', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test('the stored preference is what gets stamped', () => {
    for (const { code } of LOCALES) {
      localStorage.setItem('piqeras.locale', code);
      expect(currentLocale()).toBe(code);
    }
  });

  test('an absent or unknown preference stamps Albanian', () => {
    expect(currentLocale()).toBe('sq');
    localStorage.setItem('piqeras.locale', 'de');
    expect(currentLocale()).toBe('sq');
  });

  test('the user document carries the real language, not a two-way guess', () => {
    // Regression: this was `documentElement.lang === 'en' ? 'en' : 'sq'`, which
    // told the server "Albanian" for a Greek, Romanian or Italian member — and
    // then sent them push notifications in the language they had switched away
    // from. TypeScript cannot catch a wrong-but-valid string.
    const source = readFileSync('src/lib/repo.ts', 'utf8');
    expect(source).toContain('locale: currentLocale()');
    expect(source).not.toContain('documentElement.lang');
  });
});
