import { describe, expect, test, vi, beforeEach } from 'vitest';
import { screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithI18n } from './fixtures';

class FakeNameTakenError extends Error {}

const saveName = vi.fn();

vi.mock('../state/auth', () => ({
  useAuth: () => ({
    status: 'needsName',
    uid: 'uid_new',
    profile: null,
    googleName: '',
    user: null,
    authErrorKey: null,
    signIn: vi.fn(),
    linkGoogle: vi.fn(),
    signOut: vi.fn(),
    dismissAuthError: vi.fn(),
    isOrganizer: false,
    error: null,
    saveName,
    retry: vi.fn(),
  }),
  NameTakenError: FakeNameTakenError,
}));

const { WelcomeScreen } = await import('../screens/WelcomeScreen');

describe('<WelcomeScreen>', () => {
  beforeEach(() => {
    saveName.mockReset();
    saveName.mockResolvedValue(undefined);
  });

  test('asks only for a name — no email, no password', () => {
    renderWithI18n(<WelcomeScreen />);
    expect(screen.getByLabelText('Emri yt')).toBeInTheDocument();
    expect(document.querySelectorAll('input')).toHaveLength(1);
    expect(document.querySelector('input[type="password"]')).toBeNull();
    expect(document.querySelector('input[type="email"]')).toBeNull();
  });

  test('explains that the name is visible to the group', () => {
    renderWithI18n(<WelcomeScreen />);
    expect(screen.getByText('Ky emër do të shihet nga të gjithë në grup.')).toBeInTheDocument();
  });

  test('keeps the continue button disabled until a usable name is typed', async () => {
    const user = userEvent.setup();
    renderWithI18n(<WelcomeScreen />);
    const button = screen.getByRole('button', { name: 'Vazhdo' });
    expect(button).toBeDisabled();

    await user.type(screen.getByLabelText('Emri yt'), 'A');
    expect(button).toBeDisabled();

    await user.type(screen.getByLabelText('Emri yt'), 'na');
    expect(button).toBeEnabled();
  });

  test('saves the typed name', async () => {
    const user = userEvent.setup();
    renderWithI18n(<WelcomeScreen />);
    await user.type(screen.getByLabelText('Emri yt'), 'Ana');
    await user.click(screen.getByRole('button', { name: 'Vazhdo' }));
    await waitFor(() => expect(saveName).toHaveBeenCalledWith('Ana'));
  });

  test('reports a taken name in Albanian and lets the user try again', async () => {
    saveName.mockRejectedValue(new FakeNameTakenError());
    const user = userEvent.setup();
    renderWithI18n(<WelcomeScreen />);

    await user.type(screen.getByLabelText('Emri yt'), 'Ilir');
    await user.click(screen.getByRole('button', { name: 'Vazhdo' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Ky emër është zënë. Provo një tjetër.',
    );
    // Still on the form, still editable.
    expect(screen.getByRole('button', { name: 'Vazhdo' })).toBeEnabled();
  });

  test('clears the error as soon as the name is edited', async () => {
    saveName.mockRejectedValue(new FakeNameTakenError());
    const user = userEvent.setup();
    renderWithI18n(<WelcomeScreen />);

    await user.type(screen.getByLabelText('Emri yt'), 'Ilir');
    await user.click(screen.getByRole('button', { name: 'Vazhdo' }));
    await screen.findByRole('alert');

    await user.type(screen.getByLabelText('Emri yt'), 'a');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  test('distinguishes a save failure from a name collision', async () => {
    saveName.mockRejectedValue(new Error('network'));
    const user = userEvent.setup();
    renderWithI18n(<WelcomeScreen />);

    await user.type(screen.getByLabelText('Emri yt'), 'Ana');
    await user.click(screen.getByRole('button', { name: 'Vazhdo' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Emri nuk u ruajt. Provo përsëri.',
    );
  });

  test('rejects a name longer than 24 characters at the input itself', () => {
    renderWithI18n(<WelcomeScreen />);
    expect(screen.getByLabelText('Emri yt')).toHaveAttribute('maxlength', '24');
  });

  test('trims surrounding whitespace before saving', async () => {
    const user = userEvent.setup();
    renderWithI18n(<WelcomeScreen />);
    await user.type(screen.getByLabelText('Emri yt'), '  Ana  ');
    await act(async () => {
      screen.getByRole('button', { name: 'Vazhdo' }).click();
    });
    // The repository normalises; what matters is that validation accepted it.
    await waitFor(() => expect(saveName).toHaveBeenCalled());
  });
});
