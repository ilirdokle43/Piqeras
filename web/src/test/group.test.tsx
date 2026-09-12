import { describe, expect, test, vi, beforeEach } from 'vitest';
import { screen, within, act } from '@testing-library/react';
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

const LATER = new Date('2026-09-24T07:30:00.000Z'); // 09:30 Tirana

const state = {
  responses: loadable<ReturnType<typeof makeResponse>[]>([]),
  members: loadable([makeMember(ME, 'Ilir')]),
};

vi.mock('../lib/hooks', () => ({
  useCurrentTrip: () => loadable(makeTrip()),
  useResponses: () => state.responses,
  useMembers: () => state.members,
  useApprovedMembers: () => state.members,
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
    authErrorKey: null,
    signIn: vi.fn(),
    linkGoogle: vi.fn(),
    signOut: vi.fn(),
    dismissAuthError: vi.fn(),
    isOrganizer: false,
    error: null,
    saveName: vi.fn(),
    retry: vi.fn(),
  }),
  NameTakenError: class extends Error {},
}));

const { GroupResponsesScreen } = await import('../screens/GroupResponsesScreen');

const populated = () => [
  makeResponse('u2', 'Ana', 'yes', DEPARTURE),
  makeResponse('u3', 'Besi', 'yes', DEPARTURE, 'Kam 3 vende të lira'),
  makeResponse('u4', 'Eri', 'yes', LATER, 'Nisem pas pune'),
  makeResponse('u5', 'Drita', 'maybe', LATER),
  makeResponse('u6', 'Gent', 'no'),
];

const roster = () => [
  makeMember(ME, 'Ilir'),
  makeMember('u2', 'Ana'),
  makeMember('u3', 'Besi'),
  makeMember('u4', 'Eri'),
  makeMember('u5', 'Drita'),
  makeMember('u6', 'Gent'),
  makeMember('u7', 'Luli'),
];

describe('<GroupResponsesScreen>', () => {
  beforeEach(() => {
    state.responses = loadable(populated());
    state.members = loadable(roster());
  });

  test('groups everyone who picked the same departure time', () => {
    const { container } = renderWithI18n(<GroupResponsesScreen onBack={vi.fn()} />);
    const times = [...container.querySelectorAll('.group__time')].map((n) => n.textContent);
    expect(times).toEqual(['06:00', '09:30']);
  });

  test('orders the slots chronologically', () => {
    state.responses = loadable([
      makeResponse('u4', 'Eri', 'yes', LATER),
      makeResponse('u2', 'Ana', 'yes', DEPARTURE),
    ]);
    const { container } = renderWithI18n(<GroupResponsesScreen onBack={vi.fn()} />);
    const times = [...container.querySelectorAll('.group__time')].map((n) => n.textContent);
    expect(times).toEqual(['06:00', '09:30']);
  });

  test('shows how many people chose each slot', () => {
    // Ana + Besi at 06:00, Eri + Drita at 09:30.
    renderWithI18n(<GroupResponsesScreen onBack={vi.fn()} />);
    expect(screen.getAllByText('zgjedhur nga 2')).toHaveLength(2);
  });

  test('the count reflects the slot, not the whole group', () => {
    state.responses = loadable([
      makeResponse('u2', 'Ana', 'yes', DEPARTURE),
      makeResponse('u3', 'Besi', 'yes', DEPARTURE),
      makeResponse('u4', 'Eri', 'yes', LATER),
    ]);
    renderWithI18n(<GroupResponsesScreen onBack={vi.fn()} />);
    expect(screen.getByText('zgjedhur nga 2')).toBeInTheDocument();
    expect(screen.getByText('zgjedhur nga 1')).toBeInTheDocument();
  });

  test('counts a "maybe" towards its slot', () => {
    // Ana + Besi at 06:00; Eri (yes) + Drita (maybe) at 09:30.
    const { container } = renderWithI18n(<GroupResponsesScreen onBack={vi.fn()} />);
    const groups = container.querySelectorAll('.panel');
    expect(within(groups[1] as HTMLElement).getByText('Drita')).toBeInTheDocument();
  });

  test('keeps people who are not coming in their own section', () => {
    renderWithI18n(<GroupResponsesScreen onBack={vi.fn()} />);
    expect(screen.getByText('Nuk vijnë')).toBeInTheDocument();
    expect(screen.getByText('Gent')).toBeInTheDocument();
  });

  test('lists members who have not responded at all', () => {
    renderWithI18n(<GroupResponsesScreen onBack={vi.fn()} />);
    expect(screen.getByText('Pa përgjigje')).toBeInTheDocument();
    // Ilir and Luli are on the roster with no response document.
    expect(screen.getByText('Luli')).toBeInTheDocument();
  });

  test('marks the signed-in member as "Ti"', () => {
    state.responses = loadable([...populated(), makeResponse(ME, 'Ilir', 'yes', DEPARTURE)]);
    const { container } = renderWithI18n(<GroupResponsesScreen onBack={vi.fn()} />);
    expect(container.querySelector('.person--me')).not.toBeNull();
    expect(screen.getAllByText(/· Ti/).length).toBeGreaterThan(0);
  });

  test('shows each note', () => {
    renderWithI18n(<GroupResponsesScreen onBack={vi.fn()} />);
    expect(screen.getByText('Nisem pas pune')).toBeInTheDocument();
    expect(screen.getByText('Kam 3 vende të lira')).toBeInTheDocument();
  });

  test('switches to grouping by response status', () => {
    renderWithI18n(<GroupResponsesScreen onBack={vi.fn()} />);
    act(() => {
      screen.getByRole('button', { name: 'Sipas përgjigjes' }).click();
    });
    expect(screen.getByText('Po vijnë')).toBeInTheDocument();
    expect(screen.getByText('Ndoshta')).toBeInTheDocument();
    expect(screen.getByText('Nuk vijnë')).toBeInTheDocument();
    expect(screen.getByText('Pa përgjigje')).toBeInTheDocument();
  });

  test('shows an empty state when nobody has responded and nobody is registered', () => {
    state.responses = loadable([]);
    state.members = loadable([]);
    renderWithI18n(<GroupResponsesScreen onBack={vi.fn()} />);
    expect(screen.getByText('Ende asnjë përgjigje.')).toBeInTheDocument();
  });

  test('a departure choice on a different day keeps its own group', () => {
    const nextDay = new Date('2026-09-25T04:00:00.000Z');
    state.responses = loadable([
      makeResponse('u2', 'Ana', 'yes', DEPARTURE),
      makeResponse('u3', 'Besi', 'yes', nextDay),
    ]);
    const { container } = renderWithI18n(<GroupResponsesScreen onBack={vi.fn()} />);
    const days = [...container.querySelectorAll('.group__day')].map((n) => n.textContent);
    expect(days).toEqual(['24 Shtator', '25 Shtator']);
  });
});
