import { useState } from 'react';
import { useT } from '../i18n';
import { useAuth } from '../state/auth';
import { Background } from '../components/Background';
import { Banner } from '../components/ui';
import { GoogleMark } from '../components/GoogleMark';

/**
 * The one-time migration screen for an account that existed before Google
 * sign-in was required.
 *
 * This links a Google credential to the CURRENT account rather than creating a
 * new one, so the uid — and with it the display name, the votes and the
 * organizer role — survives untouched. Signing out here instead would strand
 * that data behind an account nobody can reach again.
 *
 * A failed link changes nothing at all: linking is atomic.
 */
export function LinkAccountScreen() {
  const t = useT();
  const { linkGoogle, signOut, authErrorKey, profile } = useAuth();
  const [busy, setBusy] = useState(false);

  async function onLink() {
    if (busy) return;
    setBusy(true);
    await linkGoogle();
    setBusy(false);
  }

  return (
    <>
      <Background imageUrl={null} />
      <main className="screen">
        <div className="column">
          <div className="spacer" />

          <div className="stack stack--tight" style={{ marginBottom: 'var(--sp-5)' }}>
            <p className="eyebrow">{t('appName')}</p>
            <h1 style={{ fontSize: 'clamp(1.75rem, 7vw, 2.5rem)', fontWeight: 600 }}>
              {t('linkTitle')}
            </h1>
          </div>

          <div className="panel stack">
            <p className="body">{t('linkLead')}</p>

            {profile?.displayName && (
              <p className="chip" style={{ alignSelf: 'flex-start' }}>
                {t('pendingSignedInAs', { name: profile.displayName })}
              </p>
            )}

            {authErrorKey && (
              <Banner tone={authErrorKey === 'authCancelled' ? 'info' : 'error'}>
                {t(authErrorKey)}
              </Banner>
            )}

            <button
              type="button"
              className="btn btn--primary btn--block"
              onClick={onLink}
              disabled={busy}
            >
              {busy ? (
                <span className="spinner" aria-hidden="true" />
              ) : (
                <>
                  <GoogleMark />
                  {t('linkAction')}
                </>
              )}
            </button>

            <button
              type="button"
              className="btn btn--quiet btn--block"
              onClick={() => void signOut()}
              disabled={busy}
            >
              {t('signOutAction')}
            </button>
          </div>

          <div className="spacer" />
        </div>
      </main>
    </>
  );
}
