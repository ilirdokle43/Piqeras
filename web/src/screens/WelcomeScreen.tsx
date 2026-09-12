import { useState, type FormEvent } from 'react';
import { useT } from '../i18n';
import { useAuth, NameTakenError } from '../state/auth';
import { validateDisplayName } from '../lib/domain';
import { Background } from '../components/Background';

/**
 * Confirming the name the group will see.
 *
 * Shown once, after the first Google sign-in. The Google account is the
 * identity; this screen only attaches a human-readable label to it, prefilled
 * from the Google profile so it is usually a single tap. The name is never used
 * for authentication or authorization — see docs/SECURITY.md.
 */
export function WelcomeScreen() {
  const t = useT();
  const { saveName, googleName } = useAuth();
  // Prefilled from the Google profile so most people only have to confirm.
  // It is a suggestion, not an identity: the uid is what owns anything.
  const [name, setName] = useState(() => googleName.trim().slice(0, 24));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;

    const check = validateDisplayName(name);
    if (!check.ok) {
      setError(check.reason === 'name_too_long' ? t('nameTooLong') : t('nameTooShort'));
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await saveName(name);
    } catch (err) {
      setError(err instanceof NameTakenError ? t('nameTaken') : t('nameSaveFailed'));
      setBusy(false);
    }
  }

  return (
    <>
      <Background imageUrl={null} />
      <main className="screen">
        <div className="column">
          <div className="spacer" />

          <div className="stack stack--tight" style={{ marginBottom: 'var(--sp-6)' }}>
            <p className="eyebrow">{t('welcomeEyebrow')}</p>
            <h1 className="hero-title">{t('welcomeTitle')}</h1>
            <p className="body" style={{ marginTop: 'var(--sp-2)' }}>
              {t('welcomeLead')}
            </p>
          </div>

          <form className="panel stack" onSubmit={onSubmit} noValidate>
            <div className="field">
              <label className="field__label" htmlFor="name">
                {t('nameLabel')}
              </label>
              <input
                id="name"
                className={`input${error ? ' input--invalid' : ''}`}
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (error) setError(null);
                }}
                placeholder={t('namePlaceholder')}
                autoComplete="nickname"
                autoCapitalize="words"
                enterKeyHint="go"
                maxLength={24}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? 'name-error' : 'name-hint'}
                disabled={busy}
              />
              {error ? (
                <p className="field__error" id="name-error" role="alert">
                  {error}
                </p>
              ) : (
                <p className="field__hint" id="name-hint">
                  {t('nameVisibilityNote')}
                </p>
              )}
            </div>

            <button
              type="submit"
              className="btn btn--primary btn--block"
              disabled={busy || name.trim().length < 2}
            >
              {busy ? <span className="spinner" aria-hidden="true" /> : t('continueAction')}
            </button>
          </form>

          <div className="spacer" />
        </div>
      </main>
    </>
  );
}
