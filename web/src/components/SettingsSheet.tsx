import { useEffect, useState, type FormEvent } from 'react';
import { LOCALES, useI18n, useT } from '../i18n';
import { useAuth, NameTakenError } from '../state/auth';
import { validateDisplayName } from '../lib/domain';
import { enablePush, pushState, type PushState } from '../lib/push';

/**
 * Name, language and notification settings.
 *
 * Renaming reuses the same atomic claim path as first registration, so the
 * uniqueness guarantee is identical and a collision leaves the old name intact.
 */
export function SettingsSheet({
  currentName,
  onClose,
}: {
  currentName: string;
  onClose: () => void;
}) {
  const t = useT();
  const { locale, setLocale } = useI18n();
  const { uid, saveName, signOut } = useAuth();

  const [name, setName] = useState(currentName);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [push, setPush] = useState<PushState>(() => pushState());
  const [pushBusy, setPushBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;

    const check = validateDisplayName(name);
    if (!check.ok) {
      setError(check.reason === 'name_too_long' ? t('nameTooLong') : t('nameTooShort'));
      return;
    }
    if (check.displayName === currentName) {
      onClose();
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await saveName(name);
      onClose();
    } catch (err) {
      setError(err instanceof NameTakenError ? t('nameTaken') : t('nameSaveFailed'));
      setBusy(false);
    }
  }

  async function onEnablePush() {
    if (!uid) return;
    setPushBusy(true);
    setPush(await enablePush(uid, locale));
    setPushBusy(false);
  }

  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-label={t('changeNameTitle')}>
        <form className="stack" onSubmit={onSubmit} noValidate>
          <p className="modal__title">{t('changeNameTitle')}</p>

          <div className="field">
            <label className="field__label" htmlFor="settings-name">
              {t('nameLabel')}
            </label>
            <input
              id="settings-name"
              className={`input${error ? ' input--invalid' : ''}`}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (error) setError(null);
              }}
              maxLength={24}
              autoCapitalize="words"
              disabled={busy}
              aria-invalid={error ? true : undefined}
            />
            {error ? (
              <p className="field__error" role="alert">
                {error}
              </p>
            ) : (
              <p className="field__hint">{t('nameVisibilityNote')}</p>
            )}
          </div>

          <div className="field">
            <span className="field__label">{t('notificationsTitle')}</span>
            {push === 'granted' && <p className="field__hint">{t('notificationsEnabled')}</p>}
            {push === 'denied' && <p className="field__hint">{t('notificationsBlocked')}</p>}
            {(push === 'unsupported' || push === 'unconfigured') && (
              <p className="field__hint">{t('notificationsUnsupported')}</p>
            )}
            {(push === 'default' || push === 'error') && (
              <button
                type="button"
                className="btn btn--ghost btn--block"
                onClick={onEnablePush}
                disabled={pushBusy}
              >
                {pushBusy ? <span className="spinner" aria-hidden="true" /> : t('enableNotifications')}
              </button>
            )}
          </div>

          <div className="field">
            <span className="field__label">Gjuha / Language</span>
            {/* A wrapping grid rather than a `btn-row`: five equal columns on a
                phone squeeze every label past reading. */}
            <div className="lang-grid">
              {LOCALES.map((option) => (
                <button
                  key={option.code}
                  type="button"
                  className={`btn ${locale === option.code ? 'btn--primary' : 'btn--ghost'}`}
                  aria-pressed={locale === option.code}
                  onClick={() => setLocale(option.code)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="btn-row">
            <button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>
              {t('cancelAction')}
            </button>
            <button type="submit" className="btn btn--primary" disabled={busy}>
              {busy ? <span className="spinner" aria-hidden="true" /> : t('saveNameAction')}
            </button>
          </div>

          <button
            type="button"
            className="btn btn--quiet btn--block"
            onClick={() => void signOut()}
            disabled={busy}
          >
            {t('signOutAction')}
          </button>
        </form>
      </div>
    </div>
  );
}
