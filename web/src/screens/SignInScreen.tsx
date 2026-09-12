import { useState } from 'react';
import { useT } from '../i18n';
import { useAuth } from '../state/auth';
import { Background } from '../components/Background';
import { Banner } from '../components/ui';
import { GoogleMark } from '../components/GoogleMark';

/**
 * The front door. Nothing about the trip is visible until somebody is through
 * it — not the date, not the countdown, not who is coming.
 */
export function SignInScreen() {
  const t = useT();
  const { signIn, authErrorKey } = useAuth();
  const [busy, setBusy] = useState(false);

  async function onSignIn() {
    if (busy) return;
    setBusy(true);
    await signIn();
    // If a popup was blocked we are already navigating away; otherwise the
    // button becomes clickable again so a cancellation can be retried.
    setBusy(false);
  }

  return (
    <>
      <Background imageUrl={null} />
      <main className="screen">
        <div className="column">
          <div className="spacer" />

          <div className="stack stack--tight" style={{ marginBottom: 'var(--sp-6)' }}>
            <p className="eyebrow">{t('welcomeEyebrow')}</p>
            <h1 className="hero-title">{t('appName')}</h1>
            <p className="body" style={{ marginTop: 'var(--sp-2)' }}>
              {t('signInLead')}
            </p>
          </div>

          <div className="panel stack">
            {authErrorKey && (
              <Banner tone={authErrorKey === 'authCancelled' ? 'info' : 'error'}>
                {t(authErrorKey)}
              </Banner>
            )}

            <button
              type="button"
              className="btn btn--primary btn--block"
              onClick={onSignIn}
              disabled={busy}
            >
              {busy ? (
                <span className="spinner" aria-hidden="true" />
              ) : (
                <>
                  <GoogleMark />
                  {t('continueWithGoogle')}
                </>
              )}
            </button>

            <p className="field__hint" style={{ textAlign: 'center' }}>
              {t('signInWhy')}
            </p>
          </div>

          <div className="spacer" />
        </div>
      </main>
    </>
  );
}
