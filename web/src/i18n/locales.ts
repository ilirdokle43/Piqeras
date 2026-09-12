/**
 * Locale primitives — deliberately free of React and of the string bundles.
 *
 * The data layer has to stamp the current language onto the user document so
 * that notifications arrive in it, and importing the provider there would drag
 * the whole component tree into a module that only wanted a two-letter code.
 */

export type Locale = 'sq' | 'en' | 'el' | 'ro' | 'it';

export const LOCALE_STORAGE_KEY = 'piqeras.locale';

/**
 * Every language, in the order the settings sheet offers them.
 *
 * Each label is written in its own language: the whole point of a language
 * picker is that somebody who cannot read the current one can still find their
 * way out of it.
 */
export const LOCALES: readonly { readonly code: Locale; readonly label: string }[] = [
  { code: 'sq', label: 'Shqip' },
  { code: 'en', label: 'English' },
  { code: 'el', label: 'Ελληνικά' },
  { code: 'ro', label: 'Română' },
  { code: 'it', label: 'Italiano' },
];

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && LOCALES.some((l) => l.code === value);
}

/**
 * The language the interface is in right now, as a storable code.
 *
 * Reads the same key the provider writes, rather than `documentElement.lang`,
 * which is only set once somebody has actually changed the language.
 */
export function currentLocale(): Locale {
  try {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (isLocale(stored)) return stored;
  } catch {
    /* private mode / storage disabled */
  }
  return 'sq';
}
