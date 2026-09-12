import { describe, expect, test, vi, beforeEach } from 'vitest';
import { screen, act, waitFor } from '@testing-library/react';
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
  now: NOW,
};

const saveMyResponse = vi.fn().mockResolvedValue(undefined);
const deleteMyResponse = vi.fn().mockResolvedValue(undefined);

vi.mock('../lib/hooks', () => ({
  useCurrentTrip: () => state.trip,
  useResponses: () => state.responses,
  useMembers: () => loadable([]),
  useApprovedMembers: () => loadable([]),
  useOrganizers: () => loadable([]),
  useMyProfile: () => loadable(null),
  useMyMembership: () => loadable(null),
  usePendingMembers: () => loadable([]),
  useNow: () => state.now,
  useOnline: () => true,
  useToast: () => [null, vi.fn()],
  useChangeNotice: () => false,
}));

vi.mock('../lib/repo', () => ({
  saveMyResponse: (...args: unknown[]) => saveMyResponse(...args),
  deleteMyResponse: (...args: unknown[]) => deleteMyResponse(...args),
  isPermissionDenied: () => false,
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

const { MyResponseScreen } = await import('../screens/MyResponseScreen');

describe('<MyResponseScreen>', () => {
  beforeEach(() => {
    state.trip = loadable(makeTrip());
    state.responses = loadable([]);
    state.now = NOW;
    saveMyResponse.mockClear();
    deleteMyResponse.mockClear();
  });

  test('offers the three attendance options in Albanian', () => {
    renderWithI18n(<MyResponseScreen onBack={vi.fn()} />);
    expect(screen.getByText('Po, do të vij')).toBeInTheDocument();
    expect(screen.getByText('Ndoshta')).toBeInTheDocument();
    expect(screen.getByText('Nuk do të vij')).toBeInTheDocument();
  });

  test('pre-fills the pickers with the trip departure for a first response', () => {
    renderWithI18n(<MyResponseScreen onBack={vi.fn()} />);
    expect(screen.getByLabelText('Data e nisjes')).toHaveValue('2026-09-24');
    expect(screen.getByLabelText('Ora e nisjes')).toHaveValue('06:00');
  });

  test('pre-fills from the saved response when one exists', () => {
    state.responses = loadable([
      makeResponse(ME, 'Ilir', 'maybe', new Date('2026-09-24T07:30:00.000Z'), 'Nisem pas pune'),
    ]);
    renderWithI18n(<MyResponseScreen onBack={vi.fn()} />);
    expect(screen.getByLabelText('Ora e nisjes')).toHaveValue('09:30');
    expect(screen.getByDisplayValue('Nisem pas pune')).toBeInTheDocument();
  });

  test('hides the departure pickers when the member is not coming', () => {
    renderWithI18n(<MyResponseScreen onBack={vi.fn()} />);
    act(() => {
      screen.getByRole('radio', { name: /Nuk do të vij/ }).click();
    });
    expect(screen.queryByLabelText('Data e nisjes')).toBeNull();
    expect(screen.queryByLabelText('Ora e nisjes')).toBeNull();
  });

  test('saves a "not coming" response with no departure', async () => {
    renderWithI18n(<MyResponseScreen onBack={vi.fn()} />);
    act(() => {
      screen.getByRole('radio', { name: /Nuk do të vij/ }).click();
    });
    act(() => {
      screen.getByRole('button', { name: 'Ruaj' }).click();
    });
    await waitFor(() => expect(saveMyResponse).toHaveBeenCalled());
    expect(saveMyResponse.mock.calls[0][3]).toMatchObject({
      attendance: 'no',
      preferredDeparture: null,
    });
  });

  test('saves the chosen departure as a UTC instant', async () => {
    renderWithI18n(<MyResponseScreen onBack={vi.fn()} />);
    act(() => {
      screen.getByRole('button', { name: 'Ruaj' }).click();
    });
    await waitFor(() => expect(saveMyResponse).toHaveBeenCalled());
    const payload = saveMyResponse.mock.calls[0][3];
    // 06:00 in Tirana during CEST.
    expect(payload.preferredDeparture.toISOString()).toBe(DEPARTURE.toISOString());
  });

  test('writes into the member’s own response slot', async () => {
    renderWithI18n(<MyResponseScreen onBack={vi.fn()} />);
    act(() => {
      screen.getByRole('button', { name: 'Ruaj' }).click();
    });
    await waitFor(() => expect(saveMyResponse).toHaveBeenCalled());
    expect(saveMyResponse.mock.calls[0][0]).toBe('trip_1');
    expect(saveMyResponse.mock.calls[0][1]).toBe(ME);
  });

  test('explains and blocks editing once voting is locked', () => {
    state.trip = loadable(makeTrip({ votingLocked: true }));
    renderWithI18n(<MyResponseScreen onBack={vi.fn()} />);
    expect(screen.getByText(/Votimi është mbyllur/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ruaj' })).toBeDisabled();
  });

  test('explains and blocks editing once the deadline has passed', () => {
    state.now = new Date('2026-09-18T10:00:00.000Z');
    renderWithI18n(<MyResponseScreen onBack={vi.fn()} />);
    expect(screen.getByText('Afati i votimit ka kaluar.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ruaj' })).toBeDisabled();
  });

  test('disables the attendance options when voting is closed', () => {
    state.trip = loadable(makeTrip({ votingLocked: true }));
    renderWithI18n(<MyResponseScreen onBack={vi.fn()} />);
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio).toBeDisabled();
    }
  });

  test('shows when the response was last saved', () => {
    state.responses = loadable([makeResponse(ME, 'Ilir', 'yes')]);
    renderWithI18n(<MyResponseScreen onBack={vi.fn()} />);
    expect(screen.getByText(/U ruajt më/)).toBeInTheDocument();
  });

  test('counts the note characters', () => {
    renderWithI18n(<MyResponseScreen onBack={vi.fn()} />);
    expect(screen.getByText('0/140')).toBeInTheDocument();
  });

  test('caps the note at 140 characters', () => {
    renderWithI18n(<MyResponseScreen onBack={vi.fn()} />);
    expect(screen.getByPlaceholderText('p.sh. Nisem pas pune')).toHaveAttribute(
      'maxlength',
      '140',
    );
  });

  test('offers to withdraw only when a response already exists', () => {
    renderWithI18n(<MyResponseScreen onBack={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Hiq përgjigjen time' })).toBeNull();

    state.responses = loadable([makeResponse(ME, 'Ilir', 'yes')]);
    renderWithI18n(<MyResponseScreen onBack={vi.fn()} />);
    expect(screen.getAllByRole('button', { name: 'Hiq përgjigjen time' }).length).toBe(1);
  });

  test('confirms before withdrawing', async () => {
    state.responses = loadable([makeResponse(ME, 'Ilir', 'yes')]);
    renderWithI18n(<MyResponseScreen onBack={vi.fn()} />);
    act(() => {
      screen.getByRole('button', { name: 'Hiq përgjigjen time' }).click();
    });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(deleteMyResponse).not.toHaveBeenCalled();
  });
});
