import { describe, expect, test, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import {
  DEPARTURE,
  ME,
  NOW,
  loadable,
  makeMember,
  makeResponse,
  makeTrip,
  renderWithI18n,
} from './fixtures';
import type { Trip } from '../lib/types';

const state = {
  trip: loadable<Trip | null>(makeTrip()),
  responses: loadable<ReturnType<typeof makeResponse>[]>([]),
  members: loadable([makeMember(ME, 'Ilir')]),
  now: NOW,
  online: true,
  isOrganizer: false,
  pending: [] as Array<{ uid: string; googleName: string; emailMasked: string; requestedAt: null }>,
};

vi.mock('../lib/hooks', () => ({
  useCurrentTrip: () => state.trip,
  useResponses: () => state.responses,
  useMembers: () => state.members,
  useApprovedMembers: () => state.members,
  useOrganizers: () => loadable([]),
  useMyProfile: () => loadable(null),
  useMyMembership: () => loadable(null),
  usePendingMembers: () => loadable(state.pending),
  useNow: () => state.now,
  useOnline: () => state.online,
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
    authErrorKey: null,
    signIn: vi.fn(),
    linkGoogle: vi.fn(),
    signOut: vi.fn(),
    dismissAuthError: vi.fn(),
    isOrganizer: state.isOrganizer,
    error: null,
    saveName: vi.fn(),
    retry: vi.fn(),
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

describe('<HomeScreen>', () => {
  beforeEach(() => {
    state.trip = loadable(makeTrip());
    state.responses = loadable([]);
    state.members = loadable([makeMember(ME, 'Ilir')]);
    state.now = NOW;
    state.online = true;
    state.isOrganizer = false;
    state.pending = [];
  });

  test('shows the trip title, the day-and-month, and the full official date', () => {
    renderWithI18n(<HomeScreen navigate={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Piqeras' })).toBeInTheDocument();
    expect(screen.getByText('24 Shtator')).toBeInTheDocument();
    expect(screen.getByText('E enjte, 24 Shtator 2026, 06:00')).toBeInTheDocument();
  });

  test('says the date is still being voted on while no final date is set', () => {
    renderWithI18n(<HomeScreen navigate={vi.fn()} />);
    expect(screen.getByText('Data ende po votohet')).toBeInTheDocument();
    expect(screen.queryByText('Data zyrtare')).not.toBeInTheDocument();
  });

  test('marks the date as official once the trip is confirmed', () => {
    state.trip = loadable(
      makeTrip({ status: 'confirmed', finalDeparture: DEPARTURE, votingLocked: true }),
    );
    renderWithI18n(<HomeScreen navigate={vi.fn()} />);
    expect(screen.getByText('Data zyrtare')).toBeInTheDocument();
  });

  test('counts down to the confirmed date rather than the proposal', () => {
    const finalDeparture = new Date('2026-09-25T04:00:00.000Z');
    state.trip = loadable(makeTrip({ status: 'confirmed', finalDeparture }));
    renderWithI18n(<HomeScreen navigate={vi.fn()} />);
    expect(screen.getByText('25 Shtator')).toBeInTheDocument();
  });

  test('renders the attendance summary from the server-owned counters', () => {
    state.trip = loadable(makeTrip({ responseCounts: { yes: 4, maybe: 1, no: 2 } }));
    state.members = loadable([
      makeMember(ME, 'Ilir'),
      makeMember('u2', 'Ana'),
      makeMember('u3', 'Besi'),
      makeMember('u4', 'Eri'),
      makeMember('u5', 'Drita'),
      makeMember('u6', 'Gent'),
      makeMember('u7', 'Luli'),
      makeMember('u8', 'Mira'),
    ]);
    state.responses = loadable([
      makeResponse(ME, 'Ilir', 'yes'),
      makeResponse('u2', 'Ana', 'yes'),
      makeResponse('u3', 'Besi', 'yes'),
      makeResponse('u4', 'Eri', 'yes'),
      makeResponse('u5', 'Drita', 'maybe'),
      makeResponse('u6', 'Gent', 'no'),
      makeResponse('u7', 'Luli', 'no'),
    ]);

    const { container } = renderWithI18n(<HomeScreen navigate={vi.fn()} />);
    const counts = [...container.querySelectorAll('.chip__count')].map((n) => n.textContent);
    // yes, maybe, no from the trip document; "no response" derived as 8 - 7.
    expect(counts).toEqual(['4', '1', '2', '1']);
  });

  test('never shows a negative "no response" count', () => {
    // A response can outlive the user document that created it.
    state.members = loadable([]);
    state.responses = loadable([makeResponse(ME, 'Ilir', 'yes')]);
    const { container } = renderWithI18n(<HomeScreen navigate={vi.fn()} />);
    const counts = [...container.querySelectorAll('.chip__count')].map((n) => n.textContent);
    expect(counts[3]).toBe('0');
  });

  test('offers to submit a response when the member has none', () => {
    renderWithI18n(<HomeScreen navigate={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Përgjigju' })).toBeInTheDocument();
  });

  test('offers to change the response once one exists', () => {
    state.responses = loadable([makeResponse(ME, 'Ilir', 'yes')]);
    renderWithI18n(<HomeScreen navigate={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Ndrysho përgjigjen' })).toBeInTheDocument();
  });

  test('hides the organizer dashboard from ordinary members', () => {
    renderWithI18n(<HomeScreen navigate={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Paneli i organizatorit' })).toBeNull();
  });

  test('shows the organizer dashboard to an organizer', () => {
    state.isOrganizer = true;
    renderWithI18n(<HomeScreen navigate={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Paneli i organizatorit' })).toBeInTheDocument();
  });

  /* ------------------------------------------------ the personal countdown */

  /**
   * Not everybody leaves together, so the countdown is the time until YOU go
   * once you have picked a time — and the trip's own departure until then.
   */
  const cells = (c: HTMLElement) =>
    [...c.querySelectorAll('.countdown__value')].map((el) => el.textContent);

  test('counts to the trip departure while you have not voted', () => {
    const { container } = renderWithI18n(<HomeScreen navigate={vi.fn()} />);
    expect(cells(container).slice(0, 2)).toEqual(['29', '18']);
    expect(container.textContent).not.toContain('Deri te nisja jote');
  });

  test('counts to your own departure once you have picked one', () => {
    // Two hours after the trip's 06:00, so the countdown gains two hours.
    const mine = new Date(DEPARTURE.getTime() + 2 * 3600_000);
    state.responses = loadable([makeResponse(ME, 'Ilir', 'yes', mine)]);

    const { container } = renderWithI18n(<HomeScreen navigate={vi.fn()} />);
    expect(cells(container).slice(0, 2)).toEqual(['29', '20']);
  });

  test('and says so, rather than silently disagreeing with the date above it', () => {
    const mine = new Date(DEPARTURE.getTime() + 2 * 3600_000);
    state.responses = loadable([makeResponse(ME, 'Ilir', 'yes', mine)]);

    const { container } = renderWithI18n(<HomeScreen navigate={vi.fn()} />);
    expect(container.textContent).toContain('Deri te nisja jote');
    expect(container.textContent).toContain('E enjte, 24 Shtator 2026, 08:00');
    // The trip's own departure still heads the screen.
    expect(screen.getByText('E enjte, 24 Shtator 2026, 06:00')).toBeInTheDocument();
  });

  test('a "maybe" counts to their own time too — they are still travelling', () => {
    const mine = new Date(DEPARTURE.getTime() + 2 * 3600_000);
    state.responses = loadable([makeResponse(ME, 'Ilir', 'maybe', mine)]);
    const { container } = renderWithI18n(<HomeScreen navigate={vi.fn()} />);
    expect(cells(container).slice(0, 2)).toEqual(['29', '20']);
  });

  test('somebody not coming sees the trip departure, not a countdown of their own', () => {
    state.responses = loadable([makeResponse(ME, 'Ilir', 'no')]);
    const { container } = renderWithI18n(<HomeScreen navigate={vi.fn()} />);
    expect(cells(container).slice(0, 2)).toEqual(['29', '18']);
    expect(container.textContent).not.toContain('Deri te nisja jote');
  });

  test('picking exactly the trip departure adds no second line about it', () => {
    state.responses = loadable([makeResponse(ME, 'Ilir', 'yes', DEPARTURE)]);
    const { container } = renderWithI18n(<HomeScreen navigate={vi.fn()} />);
    expect(cells(container).slice(0, 2)).toEqual(['29', '18']);
    expect(container.textContent).not.toContain('Deri te nisja jote');
  });

  test('somebody else\u2019s vote never moves your countdown', () => {
    state.responses = loadable([
      makeResponse('other', 'Besi', 'yes', new Date(DEPARTURE.getTime() + 5 * 3600_000)),
    ]);
    const { container } = renderWithI18n(<HomeScreen navigate={vi.fn()} />);
    expect(cells(container).slice(0, 2)).toEqual(['29', '18']);
  });

  test('shows the departure message instead of a negative countdown', () => {
    state.now = new Date(DEPARTURE.getTime() + 3600_000);
    renderWithI18n(<HomeScreen navigate={vi.fn()} />);
    expect(screen.getByText('U nisëm për Piqeras!')).toBeInTheDocument();
  });

  test('explains an offline session rather than showing stale data silently', () => {
    state.online = false;
    renderWithI18n(<HomeScreen navigate={vi.fn()} />);
    expect(screen.getByText(/Je jashtë linje/)).toBeInTheDocument();
  });

  test('shows an empty state when no trip exists', () => {
    state.trip = loadable(null);
    renderWithI18n(<HomeScreen navigate={vi.fn()} />);
    expect(screen.getByText('Ende asnjë dalje')).toBeInTheDocument();
  });

  test('flags a cancelled trip', () => {
    state.trip = loadable(makeTrip({ status: 'cancelled' }));
    renderWithI18n(<HomeScreen navigate={vi.fn()} />);
    expect(screen.getByText('Kjo dalje është anuluar.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Përgjigju' })).toBeDisabled();
  });

  test('marks voting as closed once it is locked', () => {
    state.trip = loadable(makeTrip({ votingLocked: true }));
    renderWithI18n(<HomeScreen navigate={vi.fn()} />);
    expect(screen.getByText('Votimi është mbyllur')).toBeInTheDocument();
  });

  test('marks voting as closed once the deadline has passed', () => {
    state.now = new Date('2026-09-18T10:00:00.000Z');
    renderWithI18n(<HomeScreen navigate={vi.fn()} />);
    expect(screen.getByText('Votimi është mbyllur')).toBeInTheDocument();
  });

  test('alerts an organizer when approvals are waiting', () => {
    state.isOrganizer = true;
    state.pending = [
      { uid: 'p1', googleName: 'Besi', emailMasked: 'be...@gmail.com', requestedAt: null },
      { uid: 'p2', googleName: 'Eri', emailMasked: 'er...@gmail.com', requestedAt: null },
    ];
    renderWithI18n(<HomeScreen navigate={vi.fn()} />);
    expect(screen.getByText('Ka 2 kërkesa që presin miratim.')).toBeInTheDocument();
  });

  test('does not alert an ordinary member about approvals', () => {
    state.isOrganizer = false;
    state.pending = [
      { uid: 'p1', googleName: 'Besi', emailMasked: 'x', requestedAt: null },
    ];
    renderWithI18n(<HomeScreen navigate={vi.fn()} />);
    expect(screen.queryByText(/presin miratim/)).toBeNull();
  });

  test('shows no approval alert when the queue is empty', () => {
    state.isOrganizer = true;
    renderWithI18n(<HomeScreen navigate={vi.fn()} />);
    expect(screen.queryByText(/presin miratim/)).toBeNull();
  });
});
