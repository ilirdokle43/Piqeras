import { useEffect, useRef, type ReactNode } from 'react';
import { useT } from '../i18n';
import { ShareButton } from './ShareButton';

/* --------------------------------------------------------------- app bar */

/**
 * `action` defaults to the share button, so every screen with a bar can be
 * shared without each one remembering to add it. Pass an explicit action to
 * replace it, or `null` to leave the corner empty.
 */
export function AppBar({
  title,
  onBack,
  action,
}: {
  title: string;
  onBack?: () => void;
  action?: ReactNode;
}) {
  const t = useT();
  return (
    <header className="appbar">
      {onBack && (
        <button type="button" className="icon-btn" onClick={onBack} aria-label={t('backAction')}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M15 5l-7 7 7 7"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      )}
      <h1 className="appbar__title">{title}</h1>
      {action === undefined ? <ShareButton /> : action}
    </header>
  );
}

/* ---------------------------------------------------------------- banner */

export function Banner({
  tone = 'info',
  children,
  sticky = false,
}: {
  tone?: 'info' | 'warn' | 'error';
  children: ReactNode;
  sticky?: boolean;
}) {
  return (
    <div
      className={`banner banner--${tone}${sticky ? ' banner--offline' : ''}`}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      <span>{children}</span>
    </div>
  );
}

/* ----------------------------------------------------------------- empty */

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon?: string;
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      {icon && (
        <span className="empty__icon" aria-hidden="true">
          {icon}
        </span>
      )}
      <div className="stack stack--tight">
        <p style={{ fontWeight: 600, color: 'var(--text)' }}>{title}</p>
        {body && <p className="body">{body}</p>}
      </div>
      {action}
    </div>
  );
}

/* --------------------------------------------------------------- loading */

export function Spinner({ label }: { label?: string }) {
  return (
    <div
      style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'center' }}
      role="status"
    >
      <span className="spinner" aria-hidden="true" />
      {label && <span className="body">{label}</span>}
    </div>
  );
}

export function SkeletonBlock({ height, width = '100%' }: { height: number; width?: string }) {
  return <div className="skeleton" style={{ height, width }} aria-hidden="true" />;
}

/* ----------------------------------------------------------------- toast */

export function Toast({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="toast" role="status" aria-live="polite">
      {message}
    </div>
  );
}

/* ----------------------------------------------------------------- modal */

/**
 * A confirmation dialog.
 *
 * Focus moves into the dialog on open and Escape closes it — without that, a
 * keyboard user can tab behind the backdrop and a phone user can get stuck
 * behind a destructive action they cannot dismiss.
 */
export function Modal({
  title,
  body,
  confirmLabel,
  cancelLabel,
  tone = 'primary',
  busy = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  body?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'primary' | 'danger';
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="stack">
          <div>
            <p className="modal__title">{title}</p>
            {body && <p className="body">{body}</p>}
          </div>
          <div className="btn-row">
            <button type="button" className="btn btn--ghost" onClick={onCancel} disabled={busy}>
              {cancelLabel ?? t('cancelAction')}
            </button>
            <button
              type="button"
              ref={confirmRef}
              className={`btn ${tone === 'danger' ? 'btn--danger' : 'btn--primary'}`}
              onClick={onConfirm}
              disabled={busy}
            >
              {busy ? <span className="spinner" aria-hidden="true" /> : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- avatar */

export function Avatar({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
  return (
    <span className="avatar" aria-hidden="true">
      {initials || '?'}
    </span>
  );
}
