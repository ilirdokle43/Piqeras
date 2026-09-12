import { describe, expect, test, vi, beforeEach } from 'vitest';
import { screen, act, waitFor } from '@testing-library/react';
import { renderWithI18n, makeMember, ME } from './fixtures';
import type { StringKey } from '../i18n';

const signIn = vi.fn().mockResolvedValue(undefined);
const linkGoogle = vi.fn().mockResolvedValue(undefined);
const signOut = vi.fn().mockResolvedValue(undefined);

const state = {
  status: 'signedOut' as string,
  authErrorKey: null as StringKey | null,
  profile: null as ReturnType<typeof makeMember> | null,
};

vi.mock('../state/auth', () => ({
  useAuth: () => ({
    status: state.status,
    uid: ME,
    user: null,
    profile: state.profile,
    googleName: 'Ilir Dokle',
    isOrganizer: false,
    authErrorKey: state.authErrorKey,
    error: null,
    signIn,
    linkGoogle,
    signOut,
    saveName: vi.fn(),
    retry: vi.fn(),
    dismissAuthError: vi.fn(),
  }),
  NameTakenError: class extends Error {},
}));

const { SignInScreen } = await import('../screens/SignInScreen');
const { PendingScreen } = await import('../screens/PendingScreen');
const { LinkAccountScreen } = await import('../screens/LinkAccountScreen');

beforeEach(() => {
  signIn.mockClear();
  linkGoogle.mockClear();
  signOut.mockClear();
  state.authErrorKey = null;
  state.profile = null;
});

describe('<SignInScreen>', () => {
  test('offers Google sign-in in Albanian', () => {
    renderWithI18n(<SignInScreen />);
    expect(screen.getByRole('button', { name: /Vazhdo me Google/ })).toBeInTheDocument();
  });

  test('reveals nothing about the trip', () => {
    // No date, no countdown, no names — the gate is the whole screen.
    const { container } = renderWithI18n(<SignInScreen />);
    expect(container.querySelector('.countdown')).toBeNull();
    expect(container.textContent).not.toMatch(/Shtator/);
    expect(container.textContent).not.toMatch(/\d{2}:\d{2}/);
  });

  test('explains that approval is required', () => {
    renderWithI18n(<SignInScreen />);
    expect(
      screen.getByText('Vetëm anëtarët e miratuar e shohin daljen dhe përgjigjet.'),
    ).toBeInTheDocument();
  });

  test('starts sign-in when pressed', async () => {
    renderWithI18n(<SignInScreen />);
    await act(async () => {
      screen.getByRole('button', { name: /Vazhdo me Google/ }).click();
    });
    await waitFor(() => expect(signIn).toHaveBeenCalledTimes(1));
  });

  test('shows a cancellation calmly, as information rather than an error', () => {
    state.authErrorKey = 'authCancelled';
    const { container } = renderWithI18n(<SignInScreen />);
    expect(screen.getByText(/Identifikimi u anulua/)).toBeInTheDocument();
    expect(container.querySelector('.banner--info')).not.toBeNull();
    expect(container.querySelector('.banner--error')).toBeNull();
  });

  test('shows a blocked popup as an error with the redirect explanation', () => {
    state.authErrorKey = 'authPopupBlocked';
    const { container } = renderWithI18n(<SignInScreen />);
    expect(screen.getByText(/bllokoi dritaren/)).toBeInTheDocument();
    expect(container.querySelector('.banner--error')).not.toBeNull();
  });

  test('shows a network failure', () => {
    state.authErrorKey = 'authNetwork';
    renderWithI18n(<SignInScreen />);
    expect(screen.getByText(/Nuk ka lidhje me internetin/)).toBeInTheDocument();
  });

  test('shows the already-linked case', () => {
    state.authErrorKey = 'authAlreadyLinked';
    renderWithI18n(<SignInScreen />);
    expect(screen.getByText(/e lidhur me një përdorues tjetër/)).toBeInTheDocument();
  });

  test('the sign-in button can be retried after a failure', () => {
    state.authErrorKey = 'authNetwork';
    renderWithI18n(<SignInScreen />);
    expect(screen.getByRole('button', { name: /Vazhdo me Google/ })).toBeEnabled();
  });
});

describe('<PendingScreen>', () => {
  test('tells the user they are waiting for approval', () => {
    renderWithI18n(<PendingScreen />);
    expect(screen.getByText('Në pritje të miratimit')).toBeInTheDocument();
    expect(screen.getByText(/Kërkesa jote u dërgua/)).toBeInTheDocument();
  });

  test('leaks no trip information whatsoever', () => {
    const { container } = renderWithI18n(<PendingScreen />);
    expect(container.querySelector('.countdown')).toBeNull();
    expect(container.textContent).not.toMatch(/Shtator/);
    expect(container.textContent).not.toMatch(/Po vijnë|Ndoshta|Nuk vijnë/);
  });

  test('offers no way into the app while pending', () => {
    renderWithI18n(<PendingScreen />);
    expect(screen.queryByRole('button', { name: 'Përgjigju' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Shiko të gjithë' })).toBeNull();
  });

  test('shows the chosen name so the person knows which account they used', () => {
    state.profile = makeMember(ME, 'Ilir');
    renderWithI18n(<PendingScreen />);
    expect(screen.getByText('I identifikuar si Ilir')).toBeInTheDocument();
  });

  test('confirms before signing out', async () => {
    renderWithI18n(<PendingScreen />);
    await act(async () => {
      screen.getByRole('button', { name: 'Dil nga llogaria' }).click();
    });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(signOut).not.toHaveBeenCalled();
  });

  test('signs out once confirmed', async () => {
    renderWithI18n(<PendingScreen />);
    await act(async () => {
      screen.getByRole('button', { name: 'Dil nga llogaria' }).click();
    });
    await act(async () => {
      screen.getAllByRole('button', { name: 'Dil nga llogaria' }).pop()!.click();
    });
    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
  });
});

describe('<LinkAccountScreen>', () => {
  test('explains that the existing account is kept, not replaced', () => {
    renderWithI18n(<LinkAccountScreen />);
    expect(screen.getByText(/Emri, votat dhe roli yt mbeten të njëjta/)).toBeInTheDocument();
  });

  test('links rather than signing in fresh', async () => {
    renderWithI18n(<LinkAccountScreen />);
    await act(async () => {
      screen.getByRole('button', { name: /Lidh me Google/ }).click();
    });
    await waitFor(() => expect(linkGoogle).toHaveBeenCalledTimes(1));
    // Signing in would create a NEW uid and strand the old account's data.
    expect(signIn).not.toHaveBeenCalled();
  });

  test('surfaces a failed link without implying data was lost', () => {
    state.authErrorKey = 'authAlreadyLinked';
    renderWithI18n(<LinkAccountScreen />);
    expect(screen.getByText(/e lidhur me një përdorues tjetër/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Lidh me Google/ })).toBeEnabled();
  });

  test('still allows signing out', async () => {
    renderWithI18n(<LinkAccountScreen />);
    await act(async () => {
      screen.getByRole('button', { name: 'Dil nga llogaria' }).click();
    });
    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
  });
});
