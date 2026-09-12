import { useRef, useState, type ReactNode } from 'react';
import { useT } from '../i18n';
import { useToast } from '../lib/hooks';
import {
  HIDE_IN_CAPTURE,
  screenshotFileName,
  shareScreen,
} from '../lib/screenshot';
import { Toast } from './ui';

/** Two frames: one for React to commit the card, one for the browser to lay it out. */
function nextPaint(): Promise<void> {
  return new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
}

/**
 * Shares a picture of the screen — or, where `renderCard` is given, of a
 * purpose-built card instead.
 *
 * The card is mounted only for the moment it takes to draw it, parked
 * off-screen, then unmounted. Keeping it in the tree permanently would mean a
 * second countdown re-rendering every second behind a screen nobody is looking
 * at.
 *
 * Self-contained on purpose — it carries its own feedback — so it can be
 * dropped into any app bar without every screen wiring up a toast. It marks
 * itself `data-capture-hide` so it never photographs itself.
 */
export function ShareButton({ renderCard }: { renderCard?: () => ReactNode }) {
  const t = useT();
  const [toast, showToast] = useToast();
  const [busy, setBusy] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const host = useRef<HTMLDivElement>(null);

  async function onClick() {
    if (busy) return;
    setBusy(true);
    try {
      let node: HTMLElement | null = null;
      if (renderCard) {
        setDrawing(true);
        await nextPaint();
        node = host.current?.firstElementChild as HTMLElement | null;
      }

      const outcome = await shareScreen({ fileName: screenshotFileName(), node });

      // 'shared' and 'cancelled' need no message: the system share sheet was
      // itself the feedback, and a toast after it would be noise.
      if (outcome === 'downloaded') showToast(t('screenshotSaved'));
      if (outcome === 'failed') showToast(t('shareFailed'));
    } finally {
      setDrawing(false);
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="icon-btn"
        onClick={() => void onClick()}
        disabled={busy}
        aria-label={t('shareScreenAction')}
        title={t('shareScreenAction')}
        {...{ [HIDE_IN_CAPTURE]: '' }}
      >
        {busy ? (
          <span className="spinner" aria-hidden="true" />
        ) : (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M12 15V4m0 0L8.5 7.5M12 4l3.5 3.5"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M5 13v5.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V13"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        )}
      </button>

      {/* Off-screen and inert: it exists only to be drawn. */}
      <div className="share-card-host" ref={host} aria-hidden="true">
        {drawing && renderCard?.()}
      </div>

      <Toast message={toast} />
    </>
  );
}
