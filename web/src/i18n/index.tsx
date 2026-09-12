import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { sq, type Bundle, type StringKey } from './sq';
import { en } from './en';
import { el } from './el';
import { ro } from './ro';
import { it } from './it';
import { LOCALE_STORAGE_KEY, currentLocale, type Locale } from './locales';

const BUNDLES: Record<Locale, Bundle> = { sq, en, el, ro, it };

export { LOCALES, isLocale, type Locale } from './locales';

/**
 * Albanian is the product's language, not a fallback chosen by the device.
 *
 * Deliberately NOT derived from `navigator.language`: the group is Albanian
 * but their phones are frequently set to English, and auto-switching would
 * show them a translation nobody asked for. Every other language is opt-in
 * from settings, and that choice is what gets remembered.
 */
const detectLocale = currentLocale;

export type Translate = (key: StringKey, vars?: Record<string, string | number>) => string;

interface I18nValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: Translate;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(detectLocale);

  /**
   * Keep `<html lang>` in step with the interface — on first paint, not only
   * when somebody switches.
   *
   * This is not just metadata. `text-transform: uppercase` is language-aware:
   * only under `lang="el"` does the browser drop the accents that Greek all-caps
   * must not carry, so a stored Greek preference rendered "ΚΑΛΏΣ ΉΡΘΕΣ" until
   * the user changed language by hand.
   */
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, l);
    } catch {
      /* ignore */
    }
  }, []);

  const t = useCallback<Translate>(
    (key, vars) => {
      const template = BUNDLES[locale][key] ?? sq[key] ?? key;
      if (!vars) return template;
      return template.replace(/\{(\w+)\}/g, (match, name: string) =>
        name in vars ? String(vars[name]) : match,
      );
    },
    [locale],
  );

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>');
  return ctx;
}

export function useT(): Translate {
  return useI18n().t;
}

export type { StringKey };
