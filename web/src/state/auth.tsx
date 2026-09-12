import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import {
  auth,
  completeRedirect,
  googleDisplayName,
  hasGoogleProvider,
  linkGoogleToCurrentUser,
  preparePersistence,
  signInWithGoogle,
  signOut as firebaseSignOut,
  verifiedEmail,
} from '../lib/firebase';
import {
  claimNameAndProfile,
  NameTakenError,
  requestAccess,
  savePrivateProfile,
} from '../lib/repo';
import { useMyMembership, useMyProfile, useOrganizers } from '../lib/hooks';
import { authMessageKey, isCancellation } from '../lib/authErrors';
import { LinkUidMismatchError } from '../lib/firebase';
import type { Member } from '../lib/types';
import type { StringKey } from '../i18n';

/**
 * Where the user is in the door.
 *
 *   loading     restoring the session, or completing a redirect
 *   redirecting handing off to Google, page is about to unload
 *   signedOut   no account — show the Google button
 *   needsLink   signed in WITHOUT Google: the legacy anonymous account, which
 *               must be linked rather than replaced so its uid survives
 *   needsName   Google account with no display name chosen yet
 *   pending     name chosen, waiting for an organizer to approve
 *   ready       approved member
 *   error       something went wrong that a retry might fix
 */
export type AuthStatus =
  | 'loading'
  | 'redirecting'
  | 'signedOut'
  | 'needsLink'
  | 'needsName'
  | 'pending'
  | 'ready'
  | 'error'
  /**
   * A link finished on a different uid than it started on. Terminal: access
   * initialization stops here rather than continuing as whoever we ended up as.
   */
  | 'linkMismatch';

interface AuthValue {
  status: AuthStatus;
  uid: string | null;
  user: User | null;
  profile: Member | null;
  /** Prefill for the name confirmation step. */
  googleName: string;
  /**
   * UI gating only. The server re-checks the role on every write, so this being
   * wrong can never grant anything — at worst it shows a dashboard whose writes
   * get rejected.
   */
  isOrganizer: boolean;
  /** Set when linking ended on a different uid. Terminal. */
  linkMismatch: { expectedUid: string; actualUid: string } | null;
  /** An i18n key describing the last auth failure, or null. */
  authErrorKey: StringKey | null;
  error: unknown;
  signIn: () => Promise<void>;
  linkGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  saveName: (name: string) => Promise<void>;
  retry: () => void;
  dismissAuthError: () => void;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [bootstrapped, setBootstrapped] = useState(false);
  const [redirecting, setRedirecting] = useState(false);
  const [authErrorKey, setAuthErrorKey] = useState<StringKey | null>(null);
  const [fatal, setFatal] = useState<unknown>(null);
  const [linkMismatch, setLinkMismatch] = useState<LinkUidMismatchError | null>(null);
  const [attempt, setAttempt] = useState(0);

  /**
   * Completes a redirect sign-in before anything else looks at the session.
   *
   * On a normal load getRedirectResult resolves to null, which is not an error;
   * it just means we did not arrive from Google.
   */
  useEffect(() => {
    let cancelled = false;
    setFatal(null);

    (async () => {
      await preparePersistence();
      try {
        await completeRedirect();
      } catch (err) {
        if (!cancelled && !isCancellation(err)) setAuthErrorKey(authMessageKey(err));
      }
      if (!cancelled) setBootstrapped(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [attempt]);

  useEffect(
    () =>
      onAuthStateChanged(
        auth,
        (next) => {
          setUser(next);
          setRedirecting(false);
        },
        (err) => setFatal(err),
      ),
    [],
  );

  const uid = user?.uid ?? null;
  const isGoogle = hasGoogleProvider(user);

  const {
    data: profile,
    loading: profileLoading,
    error: profileError,
  } = useMyProfile(uid, isGoogle);
  const { data: membership, loading: membershipLoading } = useMyMembership(uid, isGoogle);
  const { data: organizers } = useOrganizers(membership !== null);

  const isOrganizer = useMemo(
    () => (uid && membership ? organizers.some((o) => o.uid === uid) : false),
    [organizers, uid, membership],
  );

  /**
   * Once a Google user has a name, announce them to the organizers and record
   * their verified email privately. Both are idempotent and both are
   * best-effort: a failure here must not block a member who is already in.
   */
  const announced = useRef<string | null>(null);
  useEffect(() => {
    if (!uid || !isGoogle || !profile?.displayName) return;
    if (announced.current === uid) return;
    announced.current = uid;

    void requestAccess().catch(() => {
      announced.current = null;
    });

    const email = verifiedEmail(user);
    if (email) void savePrivateProfile(uid, email).catch(() => {});
  }, [uid, isGoogle, profile?.displayName, user]);

  const signIn = useCallback(async () => {
    setAuthErrorKey(null);
    try {
      const outcome = await signInWithGoogle();
      if (outcome.kind === 'redirecting') setRedirecting(true);
    } catch (err) {
      setAuthErrorKey(authMessageKey(err));
    }
  }, []);

  const linkGoogle = useCallback(async () => {
    setAuthErrorKey(null);
    try {
      const outcome = await linkGoogleToCurrentUser();
      if (outcome.kind === 'redirecting') {
        setRedirecting(true);
      } else {
        // A successful link does not fire onAuthStateChanged, so refresh the
        // user object ourselves to pick up the new provider.
        await auth.currentUser?.reload();
        setUser(auth.currentUser);
      }
    } catch (err) {
      // The uid invariant is not a normal auth error to retry — it means the
      // session is no longer the account we set out to migrate. Halt.
      if (err instanceof LinkUidMismatchError) {
        setLinkMismatch(err);
        return;
      }
      setAuthErrorKey(authMessageKey(err));
    }
  }, []);

  const signOut = useCallback(async () => {
    setAuthErrorKey(null);
    announced.current = null;
    await firebaseSignOut();
  }, []);

  const saveName = useCallback(
    async (name: string) => {
      if (!uid) throw new Error('not signed in');
      await claimNameAndProfile(uid, name, profile?.displayNameLower ?? null);
    },
    [uid, profile?.displayNameLower],
  );

  const retry = useCallback(() => {
    setAuthErrorKey(null);
    setAttempt((n) => n + 1);
  }, []);

  const dismissAuthError = useCallback(() => setAuthErrorKey(null), []);

  const status: AuthStatus = useMemo(() => {
    // Checked first, and never cleared by a retry: continuing after an identity
    // change is exactly what must not happen.
    if (linkMismatch) return 'linkMismatch';
    if (fatal) return 'error';
    if (redirecting) return 'redirecting';
    if (!bootstrapped) return 'loading';
    if (!user) return 'signedOut';
    // A pre-migration anonymous account: link it, never replace it.
    if (!isGoogle) return 'needsLink';
    if (profileLoading) return 'loading';
    if (profileError) return 'error';
    if (!profile?.displayName) return 'needsName';
    if (membershipLoading) return 'loading';
    return membership ? 'ready' : 'pending';
  }, [
    linkMismatch,
    fatal,
    redirecting,
    bootstrapped,
    user,
    isGoogle,
    profileLoading,
    profileError,
    profile?.displayName,
    membershipLoading,
    membership,
  ]);

  const value = useMemo<AuthValue>(
    () => ({
      status,
      uid,
      user,
      profile,
      googleName: googleDisplayName(user),
      isOrganizer,
      linkMismatch,
      authErrorKey,
      error: fatal ?? profileError,
      signIn,
      linkGoogle,
      signOut,
      saveName,
      retry,
      dismissAuthError,
    }),
    [
      status,
      uid,
      user,
      profile,
      isOrganizer,
      linkMismatch,
      authErrorKey,
      fatal,
      profileError,
      signIn,
      linkGoogle,
      signOut,
      saveName,
      retry,
      dismissAuthError,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

export { NameTakenError };
