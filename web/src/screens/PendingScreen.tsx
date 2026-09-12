import { useState } from 'react';
import { useT } from '../i18n';
import { useAuth } from '../state/auth';
import { Background } from '../components/Background';
import { Modal } from '../components/ui';

/**
 * What a signed-in but not-yet-approved person sees.
 *
 * Deliberately empty of trip information: no title, no date, no countdown, no
 * names, no responses. The Security Rules enforce that independently — this
 * screen simply never asks for any of it.
 *
 * It needs no refresh button: the approval record is watched in realtime, so
 * the moment an organizer approves, the app moves on by itself.
 */
export function PendingScreen() {
  const t = useT();
  const { profile, signOut } = useAuth();
  const [confirmSignOut, setConfirmSignOut] = useState(false);

  return (
    <>
      <Background imageUrl={null} />
      <main className="screen">
        <div className="column">
          <div className="spacer" />

          <div className="panel stack" style={{ textAlign: 'center' }}>
            <div
              className="empty__icon"
              aria-hidden="true"
              style={{ fontSize: '2.5rem', opacity: 0.9 }}
            >
              ⏳
            </div>

            <div className="stack stack--tight">
              <h1 style={{ fontSize: '1.5rem', fontWeight: 600 }}>{t('pendingTitle')}</h1>
              <p className="body">{t('pendingLead')}</p>
              <p className="muted">{t('pendingHint')}</p>
            </div>

            {profile?.displayName && (
              <p className="chip" style={{ alignSelf: 'center' }}>
                {t('pendingSignedInAs', { name: profile.displayName })}
              </p>
            )}

            <button
              type="button"
              className="btn btn--quiet btn--block"
              onClick={() => setConfirmSignOut(true)}
            >
              {t('signOutAction')}
            </button>
          </div>

          <div className="spacer" />
        </div>
      </main>

      {confirmSignOut && (
        <Modal
          title={t('signOutConfirmTitle')}
          body={t('signOutConfirmBody')}
          confirmLabel={t('signOutAction')}
          tone="danger"
          onConfirm={() => void signOut()}
          onCancel={() => setConfirmSignOut(false)}
        />
      )}
    </>
  );
}
