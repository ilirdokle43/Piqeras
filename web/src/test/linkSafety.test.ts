/**
 * Regression tests for the account-linking defect of 2026-08-26.
 *
 * A blocked popup fell back to linkWithRedirect; the redirect completed as a
 * sign-in and silently created a second account, stranding the original one's
 * organizer role. These tests pin the two guarantees that prevent it:
 *
 *   1. linking NEVER falls back to a redirect
 *   2. linking fails loudly if the resulting uid is not the uid it started on
 */

import { describe, expect, test, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

const linkWithPopup = vi.fn();
const linkWithRedirect = vi.fn();
const signInWithPopup = vi.fn();
const signInWithRedirect = vi.fn();
const authState: { currentUser: { uid: string } | null } = { currentUser: null };

vi.mock('firebase/app', () => ({ initializeApp: () => ({}) }));
vi.mock('firebase/firestore', () => ({
  initializeFirestore: () => ({}),
  persistentLocalCache: () => ({}),
  persistentMultipleTabManager: () => ({}),
}));
vi.mock('firebase/storage', () => ({ getStorage: () => ({}) }));
vi.mock('firebase/functions', () => ({ getFunctions: () => ({}) }));

vi.mock('firebase/auth', () => ({
  getAuth: () => authState,
  GoogleAuthProvider: class {
    setCustomParameters() {}
  },
  signInWithPopup: (...a: unknown[]) => signInWithPopup(...a),
  signInWithRedirect: (...a: unknown[]) => signInWithRedirect(...a),
  getRedirectResult: vi.fn(),
  linkWithPopup: (...a: unknown[]) => linkWithPopup(...a),
  // Exported so that if the source ever imports it again, this mock records it.
  linkWithRedirect: (...a: unknown[]) => linkWithRedirect(...a),
  signOut: vi.fn(),
  onAuthStateChanged: vi.fn(),
  setPersistence: vi.fn().mockResolvedValue(undefined),
  browserLocalPersistence: {},
}));

const { linkGoogleToCurrentUser, signInWithGoogle, LinkUidMismatchError, NoCurrentUserError } =
  await import('../lib/firebase');

const popupBlocked = Object.assign(new Error('blocked'), { code: 'auth/popup-blocked' });
const cancelled = Object.assign(new Error('closed'), { code: 'auth/popup-closed-by-user' });

beforeEach(() => {
  linkWithPopup.mockReset();
  linkWithRedirect.mockReset();
  signInWithPopup.mockReset();
  signInWithRedirect.mockReset();
  authState.currentUser = { uid: 'uid_original' };
});

describe('linking never falls back to a redirect', () => {
  test('a blocked popup throws instead of redirecting', async () => {
    linkWithPopup.mockRejectedValue(popupBlocked);

    await expect(linkGoogleToCurrentUser()).rejects.toBe(popupBlocked);
    // The exact bug: this must never be reached during a link.
    expect(linkWithRedirect).not.toHaveBeenCalled();
    expect(signInWithRedirect).not.toHaveBeenCalled();
  });

  test('a storage-partitioned browser throws instead of redirecting', async () => {
    const unsupported = Object.assign(new Error('nope'), {
      code: 'auth/web-storage-unsupported',
    });
    linkWithPopup.mockRejectedValue(unsupported);

    await expect(linkGoogleToCurrentUser()).rejects.toBe(unsupported);
    expect(linkWithRedirect).not.toHaveBeenCalled();
  });

  test('a cancelled popup throws instead of redirecting', async () => {
    linkWithPopup.mockRejectedValue(cancelled);

    await expect(linkGoogleToCurrentUser()).rejects.toBe(cancelled);
    expect(linkWithRedirect).not.toHaveBeenCalled();
  });

  test('a failed link never signs in as somebody else', async () => {
    linkWithPopup.mockRejectedValue(popupBlocked);

    await expect(linkGoogleToCurrentUser()).rejects.toBeTruthy();
    expect(signInWithPopup).not.toHaveBeenCalled();
    expect(signInWithRedirect).not.toHaveBeenCalled();
    // The session is untouched.
    expect(authState.currentUser).toEqual({ uid: 'uid_original' });
  });
});

describe('the post-operation uid invariant', () => {
  test('a link that returns the same uid succeeds', async () => {
    linkWithPopup.mockResolvedValue({ user: { uid: 'uid_original' } });

    const outcome = await linkGoogleToCurrentUser();
    expect(outcome).toEqual({ kind: 'signedIn', user: { uid: 'uid_original' } });
  });

  test('a link that returns a DIFFERENT uid is rejected', async () => {
    // Exactly what happened in production: ZIlq… came back instead of bTrF….
    linkWithPopup.mockResolvedValue({ user: { uid: 'uid_somebody_else' } });

    await expect(linkGoogleToCurrentUser()).rejects.toBeInstanceOf(LinkUidMismatchError);
  });

  test('the mismatch error carries both uids for diagnosis', async () => {
    linkWithPopup.mockResolvedValue({ user: { uid: 'uid_somebody_else' } });

    const err = await linkGoogleToCurrentUser().catch((e) => e);
    expect(err).toBeInstanceOf(LinkUidMismatchError);
    expect(err.expectedUid).toBe('uid_original');
    expect(err.actualUid).toBe('uid_somebody_else');
  });

  test('linking with no current user refuses rather than signing in', async () => {
    authState.currentUser = null;

    await expect(linkGoogleToCurrentUser()).rejects.toBeInstanceOf(NoCurrentUserError);
    expect(linkWithPopup).not.toHaveBeenCalled();
    expect(signInWithPopup).not.toHaveBeenCalled();
  });

  test('the uid is captured BEFORE the popup, not read back afterwards', async () => {
    // If the invariant compared against auth.currentUser after the call, a
    // session swap during the popup would go undetected.
    linkWithPopup.mockImplementation(async () => {
      authState.currentUser = { uid: 'uid_somebody_else' };
      return { user: { uid: 'uid_somebody_else' } };
    });

    await expect(linkGoogleToCurrentUser()).rejects.toBeInstanceOf(LinkUidMismatchError);
  });
});

describe('ordinary sign-in keeps its redirect fallback', () => {
  test('a blocked popup falls back to redirect', async () => {
    signInWithPopup.mockRejectedValue(popupBlocked);
    signInWithRedirect.mockResolvedValue(undefined);

    const outcome = await signInWithGoogle();
    expect(outcome).toEqual({ kind: 'redirecting' });
    expect(signInWithRedirect).toHaveBeenCalledTimes(1);
  });

  test('a cancelled popup does NOT redirect', async () => {
    signInWithPopup.mockRejectedValue(cancelled);

    await expect(signInWithGoogle()).rejects.toBe(cancelled);
    expect(signInWithRedirect).not.toHaveBeenCalled();
  });

  test('a successful popup does not redirect', async () => {
    signInWithPopup.mockResolvedValue({ user: { uid: 'uid_new' } });

    const outcome = await signInWithGoogle();
    expect(outcome).toEqual({ kind: 'signedIn', user: { uid: 'uid_new' } });
    expect(signInWithRedirect).not.toHaveBeenCalled();
  });
});

describe('the fallback cannot be reintroduced by accident', () => {
  test('firebase.ts neither imports nor calls linkWithRedirect', () => {
    // Belt and braces: the behavioural tests above rely on the mock recording
    // calls, but if the import is simply gone the call is impossible. The name
    // may still appear in prose explaining why it is absent.
    const source = readFileSync('src/lib/firebase.ts', 'utf8');
    expect(source, 'must not import it').not.toMatch(/^\s*linkWithRedirect,\s*$/m);
    expect(source, 'must not call it').not.toMatch(/linkWithRedirect\s*\(/);
  });

  test('firebase.ts still uses signInWithRedirect for ordinary sign-in', () => {
    const source = readFileSync('src/lib/firebase.ts', 'utf8');
    expect(source).toContain('signInWithRedirect');
  });

  test('the link function compares against a uid captured up front', () => {
    const source = readFileSync('src/lib/firebase.ts', 'utf8');
    expect(source).toContain('const uidBefore = user.uid');
    expect(source).toContain('LinkUidMismatchError');
  });
});
