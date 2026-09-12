import { describe, expect, test, vi, beforeEach } from 'vitest';
import { screen, act } from '@testing-library/react';
import { ME, NOW, loadable, makeTrip, renderWithI18n } from './fixtures';
import type { Trip, Attendee } from '../lib/types';

const state = {
  history: [] as Trip[],
  attendees: [] as Attendee[],
  trip: null as Trip | null,
};

vi.mock('../lib/hooks', () => ({
  useCurrentTrip: () => loadable(null),
  useTrip: () => loadable(state.trip),
  useHistory: () => loadable(state.history),
  useAttendees: () => loadable(state.attendees),
  useResponses: () => loadable([]),
  useMembers: () => loadable([]),
  useApprovedMembers: () => loadable([]),
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
    profile: null,
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

const { HistoryScreen } = await import('../screens/HistoryScreen');
const { TripDetailScreen } = await import('../screens/TripDetailScreen');

/** 18 July 2026, 12:00 Europe/Tirane — the date-only anchor. */
const JULY_2026 = new Date('2026-07-18T10:00:00.000Z');
const AUG_2025 = new Date('2025-08-10T10:00:00.000Z');
const SEP_2026 = new Date('2026-09-24T04:00:00.000Z');

const past = (over: Partial<Trip>): Trip =>
  makeTrip({
    status: 'completed',
    isCurrent: false,
    votingLocked: true,
    visible: true,
    ...over,
  });

const attendee = (id: string, displayName: string, over: Partial<Attendee> = {}): Attendee => ({
  id,
  uid: null,
  displayName,
  attendance: 'yes',
  note: null,
  preferredDeparture: null,
  source: 'manual',
  ...over,
});

beforeEach(() => {
  state.history = [];
  state.attendees = [];
  state.trip = null;
});

describe('<HistoryScreen>', () => {
  test('shows an Albanian empty state when there is no history', () => {
    renderWithI18n(<HistoryScreen onBack={vi.fn()} onOpenTrip={vi.fn()} />);
    expect(screen.getByText('Ende asnjë dalje e kaluar.')).toBeInTheDocument();
    expect(screen.getByText('Kur të përfundojë një dalje, do të shfaqet këtu.')).toBeInTheDocument();
  });

  test('lists past trips newest first', () => {
    state.history = [
      past({ id: 'old', proposedDeparture: AUG_2025, title: 'Piqeras 2025' }),
      past({ id: 'new', proposedDeparture: JULY_2026, title: 'Piqeras 2026' }),
    ];
    const { container } = renderWithI18n(
      <HistoryScreen onBack={vi.fn()} onOpenTrip={vi.fn()} />,
    );
    const titles = [...container.querySelectorAll('.history-card__title')].map(
      (n) => n.textContent,
    );
    expect(titles).toEqual(['Piqeras 2026', 'Piqeras 2025']);
  });

  test('a date-only trip shows the date and NO time', () => {
    state.history = [past({ id: 'a', proposedDeparture: JULY_2026, datePrecision: 'dateOnly' })];
    const { container } = renderWithI18n(
      <HistoryScreen onBack={vi.fn()} onOpenTrip={vi.fn()} />,
    );
    const date = container.querySelector('.history-card__date')!.textContent!;
    expect(date).toBe('18 Korrik 2026');
    // The whole point of datePrecision: no fabricated midnight, no clock at all.
    expect(date).not.toMatch(/\d{2}:\d{2}/);
    expect(date).not.toContain('00:00');
    expect(date).not.toContain('12:00');
  });

  test('a full date/time trip shows its time', () => {
    state.history = [past({ id: 'b', proposedDeparture: SEP_2026, datePrecision: 'dateTime' })];
    const { container } = renderWithI18n(
      <HistoryScreen onBack={vi.fn()} onOpenTrip={vi.fn()} />,
    );
    expect(container.querySelector('.history-card__date')!.textContent).toBe(
      'E enjte, 24 Shtator 2026, 06:00',
    );
  });

  test('shows the attendee count', () => {
    state.history = [past({ id: 'a', attendeeCount: 7 })];
    renderWithI18n(<HistoryScreen onBack={vi.fn()} onOpenTrip={vi.fn()} />);
    expect(screen.getByText('7 pjesëmarrës')).toBeInTheDocument();
  });

  test('singular wording for one attendee', () => {
    state.history = [past({ id: 'a', attendeeCount: 1 })];
    renderWithI18n(<HistoryScreen onBack={vi.fn()} onOpenTrip={vi.fn()} />);
    expect(screen.getByText('1 pjesëmarrës')).toBeInTheDocument();
  });

  test('a trip with no recorded attendees says so', () => {
    state.history = [past({ id: 'a', attendeeCount: 0 })];
    renderWithI18n(<HistoryScreen onBack={vi.fn()} onOpenTrip={vi.fn()} />);
    expect(screen.getByText('Pa pjesëmarrës të regjistruar')).toBeInTheDocument();
  });

  test('marks every card completed', () => {
    state.history = [past({ id: 'a' }), past({ id: 'b', proposedDeparture: AUG_2025 })];
    expect(
      renderWithI18n(<HistoryScreen onBack={vi.fn()} onOpenTrip={vi.fn()} />)
        .container.querySelectorAll('.chip--locked').length,
    ).toBe(2);
  });

  test('opens a trip when its card is pressed', () => {
    const onOpenTrip = vi.fn();
    state.history = [past({ id: 'trip_x' })];
    renderWithI18n(<HistoryScreen onBack={vi.fn()} onOpenTrip={onOpenTrip} />);
    act(() => {
      (document.querySelector('.history-card') as HTMLButtonElement).click();
    });
    expect(onOpenTrip).toHaveBeenCalledWith('trip_x');
  });

  test('shows an optional description when present', () => {
    state.history = [past({ id: 'a', description: 'Dalja e verës' })];
    renderWithI18n(<HistoryScreen onBack={vi.fn()} onOpenTrip={vi.fn()} />);
    expect(screen.getByText('Dalja e verës')).toBeInTheDocument();
  });
});

describe('<TripDetailScreen>', () => {
  test('a date-only trip states the time is unknown instead of inventing one', () => {
    state.trip = past({ id: 'a', proposedDeparture: JULY_2026, datePrecision: 'dateOnly' });
    const { container } = renderWithI18n(<TripDetailScreen tripId="a" onBack={vi.fn()} />);
    expect(screen.getByText('18 Korrik 2026')).toBeInTheDocument();
    expect(screen.getByText('Ora e nisjes nuk dihet')).toBeInTheDocument();
    expect(container.textContent).not.toContain('00:00');
  });

  test('a known departure time is shown', () => {
    state.trip = past({
      id: 'a',
      proposedDeparture: SEP_2026,
      datePrecision: 'dateTime',
      finalDeparture: SEP_2026,
    });
    renderWithI18n(<TripDetailScreen tripId="a" onBack={vi.fn()} />);
    expect(screen.getByText(/Ora e nisjes: 06:00/)).toBeInTheDocument();
  });

  test('lists attendee names from snapshots', () => {
    state.trip = past({ id: 'a' });
    state.attendees = [
      attendee('1', 'Dritan'),
      attendee('2', 'Ana', { uid: 'u2', source: 'response' }),
    ];
    renderWithI18n(<TripDetailScreen tripId="a" onBack={vi.fn()} />);
    expect(screen.getByText('Dritan')).toBeInTheDocument();
    expect(screen.getByText('Ana')).toBeInTheDocument();
  });

  test('a manual attendee with no account is shown like anybody else', () => {
    // Historical friends must never need a fake Firebase account.
    state.trip = past({ id: 'a' });
    state.attendees = [attendee('m1', 'Shoku i vjetër', { uid: null, source: 'manual' })];
    renderWithI18n(<TripDetailScreen tripId="a" onBack={vi.fn()} />);
    expect(screen.getByText('Shoku i vjetër')).toBeInTheDocument();
  });

  test('people who did not come are not listed as attendees', () => {
    state.trip = past({ id: 'a' });
    state.attendees = [
      attendee('1', 'Ana'),
      attendee('2', 'Gent', { attendance: 'no' }),
    ];
    renderWithI18n(<TripDetailScreen tripId="a" onBack={vi.fn()} />);
    expect(screen.getByText('Ana')).toBeInTheDocument();
    expect(screen.queryByText('Gent')).toBeNull();
  });

  test('"maybe" attendees are counted and marked', () => {
    state.trip = past({ id: 'a' });
    state.attendees = [attendee('1', 'Ana'), attendee('2', 'Drita', { attendance: 'maybe' })];
    renderWithI18n(<TripDetailScreen tripId="a" onBack={vi.fn()} />);
    expect(screen.getByText('2 pjesëmarrës')).toBeInTheDocument();
    expect(screen.getByText('Drita')).toBeInTheDocument();
  });

  test('shows departure choices when that trip had them', () => {
    state.trip = past({ id: 'a', datePrecision: 'dateTime' });
    state.attendees = [
      attendee('1', 'Ana', { preferredDeparture: SEP_2026, source: 'response' }),
    ];
    renderWithI18n(<TripDetailScreen tripId="a" onBack={vi.fn()} />);
    expect(screen.getByText('Zgjedhjet e nisjes')).toBeInTheDocument();
    expect(screen.getByText('06:00')).toBeInTheDocument();
  });

  test('hides the choices section when no times were recorded', () => {
    state.trip = past({ id: 'a', datePrecision: 'dateOnly' });
    state.attendees = [attendee('1', 'Dritan')];
    renderWithI18n(<TripDetailScreen tripId="a" onBack={vi.fn()} />);
    expect(screen.queryByText('Zgjedhjet e nisjes')).toBeNull();
  });

  test('marks the trip completed', () => {
    state.trip = past({ id: 'a' });
    renderWithI18n(<TripDetailScreen tripId="a" onBack={vi.fn()} />);
    expect(screen.getByText('E përfunduar')).toBeInTheDocument();
  });

  test('a cancelled trip is clearly marked cancelled, not completed', () => {
    state.trip = past({ id: 'a', status: 'cancelled' });
    renderWithI18n(<TripDetailScreen tripId="a" onBack={vi.fn()} />);
    expect(screen.getByText('E anuluar')).toBeInTheDocument();
    expect(screen.getByText('Kjo dalje u anulua dhe nuk u zhvillua.')).toBeInTheDocument();
    expect(screen.queryByText('E përfunduar')).toBeNull();
  });

  test('shows an optional memory note', () => {
    state.trip = past({ id: 'a', memory: 'Dita më e nxehtë' });
    renderWithI18n(<TripDetailScreen tripId="a" onBack={vi.fn()} />);
    expect(screen.getByText('Dita më e nxehtë')).toBeInTheDocument();
  });

  test('shows an optional return date', () => {
    state.trip = past({ id: 'a', returnDate: new Date('2026-07-20T10:00:00.000Z') });
    renderWithI18n(<TripDetailScreen tripId="a" onBack={vi.fn()} />);
    expect(screen.getByText(/Kthimi: 20 Korrik 2026/)).toBeInTheDocument();
  });

  test('an empty attendee list is handled gracefully', () => {
    state.trip = past({ id: 'a', attendeeCount: 0 });
    state.attendees = [];
    renderWithI18n(<TripDetailScreen tripId="a" onBack={vi.fn()} />);
    expect(screen.getByText('Pa pjesëmarrës të regjistruar')).toBeInTheDocument();
  });

  test('a missing trip says so rather than crashing', () => {
    state.trip = null;
    renderWithI18n(<TripDetailScreen tripId="ghost" onBack={vi.fn()} />);
    expect(screen.getByText('Kjo dalje nuk u gjet.')).toBeInTheDocument();
  });

  test('snapshots survive a renamed live profile', () => {
    // The snapshot carries its own name; nothing here reads a live user doc.
    state.trip = past({ id: 'a' });
    state.attendees = [attendee('u1', 'Emri i Vjetër', { uid: 'u1', source: 'response' })];
    renderWithI18n(<TripDetailScreen tripId="a" onBack={vi.fn()} />);
    expect(screen.getByText('Emri i Vjetër')).toBeInTheDocument();
  });
});
