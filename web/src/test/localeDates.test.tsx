import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { I18nProvider, type Locale } from '../i18n';
import { ME, NOW, loadable, makeMember, makeTrip } from './fixtures';
import type { Trip } from '../lib/types';

/**
 * Regression: switching the interface to English left every date in Albanian
 * ("Wednesday" UI, "23 Shtator" date). Place names must stay untranslated;
 * months and weekdays must not.
 */

const state = {
  trip: makeTrip() as Trip | null,
  history: [] as Trip[],
};

vi.mock('../lib/hooks', () => ({
  useCurrentTrip: () => loadable(state.trip),
  useTrip: () => loadable(state.trip),
  useHistory: () => loadable(state.history),
  useAttendees: () => loadable([]),
  useResponses: () => loadable([]),
  useMembers: () => loadable([makeMember(ME, 'Ilir')]),
  useApprovedMembers: () => loadable([makeMember(ME, 'Ilir')]),
  useOrganizers: () => loadable([]),
  useMyProfile: () => loadable(null),
  useMyMembership: () => loadable(null),
  usePendingMembers: () => loadable([]),
  useNow: () => NOW,
  useOnline: () => true,
  useToast: () => [null, vi.fn()],
  useChangeNotice: () => false,
}));

vi.mock('../state/auth', () => ({
  useAuth: () => ({
    status: 'ready',
    uid: ME,
    profile: makeMember(ME, 'Ilir'),
    googleName: '',
    user: null,
    isOrganizer: false,
    authErrorKey: null,
    error: null,
    signIn: vi.fn(),
    linkGoogle: vi.fn(),
    signOut: vi.fn(),
    saveName: vi.fn(),
    retry: vi.fn(),
    dismissAuthError: vi.fn(),
  }),
  NameTakenError: class extends Error {},
}));

vi.mock('../lib/push', () => ({
  pushState: () => 'unsupported',
  enablePush: vi.fn(),
  touchExistingToken: vi.fn(),
  registerOfflineWorker: vi.fn(),
}));

const { HomeScreen } = await import('../screens/HomeScreen');
const { HistoryScreen } = await import('../screens/HistoryScreen');

/** Every Albanian month, for asserting that none of them leaks elsewhere. */
const ALBANIAN_MONTHS = ['Janar', 'Shkurt', 'Mars', 'Prill', 'Qershor', 'Korrik',
                         'Gusht', 'Shtator', 'Tetor', 'Nëntor', 'Dhjetor'];

/** Renders with a chosen interface language, as the settings sheet would. */
function renderIn(locale: Locale, ui: ReactElement) {
  localStorage.setItem('piqeras.locale', locale);
  return render(<I18nProvider>{ui}</I18nProvider>);
}

beforeEach(() => {
  localStorage.clear();
  state.trip = makeTrip();
  state.history = [];
});

describe('the home screen follows the interface language', () => {
  test('Albanian shows Albanian months', () => {
    const { container } = renderIn('sq', <HomeScreen navigate={vi.fn()} />);
    expect(container.textContent).toContain('24 Shtator');
    expect(container.textContent).toContain('E enjte, 24 Shtator 2026, 06:00');
  });

  test('English shows English months and weekdays', () => {
    const { container } = renderIn('en', <HomeScreen navigate={vi.fn()} />);
    expect(container.textContent).toContain('24 September');
    expect(container.textContent).toContain('Thursday, 24 September 2026, 06:00');
  });

  test('no Albanian month leaks into the English screen', () => {
    const { container } = renderIn('en', <HomeScreen navigate={vi.fn()} />);
    for (const month of ALBANIAN_MONTHS) {
      expect(container.textContent, `"${month}" must not appear`).not.toContain(month);
    }
  });

  test('no Albanian weekday leaks into the English screen', () => {
    const { container } = renderIn('en', <HomeScreen navigate={vi.fn()} />);
    for (const day of ['E hënë', 'E martë', 'E mërkurë', 'E enjte', 'E premte',
                       'E shtunë', 'E diel']) {
      expect(container.textContent, `"${day}" must not appear`).not.toContain(day);
    }
  });

  test('the voting deadline is translated too', () => {
    const { container } = renderIn('en', <HomeScreen navigate={vi.fn()} />);
    expect(container.textContent).toMatch(/Voting closes on .*September 2026/);
  });

  test('place names are NOT translated', () => {
    // "Piqeras" and "Sarandë" are the trip's own words in both languages.
    const sq = renderIn('sq', <HomeScreen navigate={vi.fn()} />).container.textContent!;
    localStorage.clear();
    const en = renderIn('en', <HomeScreen navigate={vi.fn()} />).container.textContent!;
    for (const text of [sq, en]) {
      expect(text).toContain('Piqeras');
      expect(text).toContain('Sarandë');
    }
  });

  test.each([
    ['el' as const, '24 Σεπτεμβρίου', 'Πέμπτη, 24 Σεπτεμβρίου 2026, 07:00'],
    ['ro' as const, '24 septembrie', 'Joi, 24 septembrie 2026, 07:00'],
    ['it' as const, '24 settembre', 'Giovedì, 24 settembre 2026, 06:00'],
  ])('%s shows its own month, weekday and clock', (locale, dayMonth, full) => {
    const { container } = renderIn(locale, <HomeScreen navigate={vi.fn()} />);
    expect(container.textContent).toContain(dayMonth);
    expect(container.textContent).toContain(full);
  });

  test('the departure is shown on the clock the reader is on', () => {
    // 06:00 in Tirana is 07:00 in Athens and Bucharest, and 06:00 in Rome.
    const shown = (locale: Locale) => {
      localStorage.clear();
      const { container, unmount } = renderIn(locale, <HomeScreen navigate={vi.fn()} />);
      const text = container.textContent!;
      unmount();
      return text;
    };
    expect(shown('sq')).toContain('06:00');
    expect(shown('en')).toContain('06:00');
    expect(shown('it')).toContain('06:00');
    expect(shown('el')).toContain('07:00');
    expect(shown('ro')).toContain('07:00');
    expect(shown('el')).not.toContain('06:00');
  });

  test('a shifted clock says so, and an unshifted one stays quiet', () => {
    // A silent hour is how somebody misses the bus; Rome agrees with Tirana, so
    // an Italian reader gets no line of noise about a difference they cannot see.
    const notice = {
      el: 'Οι ώρες εμφανίζονται σε ώρα Ελλάδας.',
      ro: 'Orele sunt afișate în ora României.',
      it: 'Gli orari sono mostrati in ora italiana.',
      sq: 'Orët tregohen sipas orës së Shqipërisë.',
    };
    const shown = (locale: Locale) => {
      localStorage.clear();
      const { container, unmount } = renderIn(locale, <HomeScreen navigate={vi.fn()} />);
      const text = container.textContent!;
      unmount();
      return text;
    };
    expect(shown('el')).toContain(notice.el);
    expect(shown('ro')).toContain(notice.ro);
    expect(shown('it')).not.toContain(notice.it);
    expect(shown('sq')).not.toContain(notice.sq);
  });

  test('no Albanian month leaks into any other language', () => {
    for (const locale of ['en', 'el', 'ro', 'it'] as const) {
      localStorage.clear();
      const { container, unmount } = renderIn(locale, <HomeScreen navigate={vi.fn()} />);
      for (const month of ALBANIAN_MONTHS) {
        expect(container.textContent, `"${month}" must not appear in ${locale}`)
          .not.toContain(month);
      }
      unmount();
    }
  });

  test('the countdown reads an hour shorter in Greek and Romanian, by request', () => {
    /*
     * The true remaining time is 29d 18h in every zone — a countdown is a gap,
     * and converting a timezone moves both ends together.
     *
     * Greek and Romanian deliberately show 29d 17h instead: the owner asked for
     * it after being shown that it makes their countdown hit zero an hour
     * before the group leaves. Pinned here so it stays a decision rather than
     * something a future reader quietly "corrects".
     */
    const hours = (locale: Locale) => {
      localStorage.clear();
      const { container, unmount } = renderIn(locale, <HomeScreen navigate={vi.fn()} />);
      const cells = [...container.querySelectorAll('.countdown__value')].map(
        (el) => el.textContent,
      );
      unmount();
      return cells;
    };

    for (const locale of ['sq', 'en', 'it'] as const) {
      expect(hours(locale).slice(0, 2), locale).toEqual(['29', '18']);
    }
    for (const locale of ['el', 'ro'] as const) {
      expect(hours(locale).slice(0, 2), locale).toEqual(['29', '17']);
    }
  });

  test('the countdown labels switch language', () => {
    expect(
      renderIn('sq', <HomeScreen navigate={vi.fn()} />).container.textContent,
    ).toContain('Ditë');
    localStorage.clear();
    expect(
      renderIn('en', <HomeScreen navigate={vi.fn()} />).container.textContent,
    ).toContain('Days');
  });
});

describe('Historiku follows the interface language', () => {
  const july = new Date('2026-07-18T10:00:00.000Z'); // date-only anchor

  test('a date-only card reads "18 Korrik 2026" in Albanian', () => {
    state.history = [
      makeTrip({ id: 'h', status: 'completed', isCurrent: false,
                 proposedDeparture: july, datePrecision: 'dateOnly' }),
    ];
    renderIn('sq', <HistoryScreen onBack={vi.fn()} onOpenTrip={vi.fn()} />);
    expect(screen.getByText('18 Korrik 2026')).toBeInTheDocument();
  });

  test('a date-only card keeps date-only precision in every language', () => {
    // The date is the whole point of the card; a language that silently gained
    // a 00:00 would be inventing a departure time nobody recorded.
    const expected: ReadonlyArray<readonly [Locale, string]> = [
      ['sq', '18 Korrik 2026'],
      ['en', '18 July 2026'],
      ['el', '18 Ιουλίου 2026'],
      ['ro', '18 iulie 2026'],
      ['it', '18 luglio 2026'],
    ];
    for (const [locale, text] of expected) {
      localStorage.clear();
      state.history = [
        makeTrip({ id: 'h', status: 'completed', isCurrent: false,
                   proposedDeparture: july, datePrecision: 'dateOnly' }),
      ];
      const { container, unmount } = renderIn(
        locale,
        <HistoryScreen onBack={vi.fn()} onOpenTrip={vi.fn()} />,
      );
      const date = container.querySelector('.history-card__date')!.textContent!;
      expect(date, locale).toBe(text);
      expect(date, locale).not.toMatch(/\d{2}:\d{2}/);
      unmount();
    }
  });

  test('and "18 July 2026" in English, still with no time', () => {
    state.history = [
      makeTrip({ id: 'h', status: 'completed', isCurrent: false,
                 proposedDeparture: july, datePrecision: 'dateOnly' }),
    ];
    const { container } = renderIn('en', <HistoryScreen onBack={vi.fn()} onOpenTrip={vi.fn()} />);
    const date = container.querySelector('.history-card__date')!.textContent!;
    expect(date).toBe('18 July 2026');
    expect(date).not.toMatch(/\d{2}:\d{2}/);
  });
});
