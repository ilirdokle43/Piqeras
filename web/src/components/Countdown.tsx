import { computeCountdown } from '../lib/domain';
import { useT } from '../i18n';

interface Props {
  target: Date;
  now: Date;
}

/**
 * The live countdown.
 *
 * Two details do most of the work here:
 *
 *  - `font-variant-numeric: tabular-nums` (in CSS) so every digit occupies the
 *    same width. Without it the whole row nudges sideways once a second, which
 *    is exactly the kind of restlessness the design brief rules out.
 *  - number and label are stacked in their own cell rather than run together
 *    inline. The reference screenshot reads "30Days 9Hours" and clips
 *    "Seconds" off the edge; a four-column grid cannot do that at any width.
 */
export function Countdown({ target, now }: Props) {
  const t = useT();
  const c = computeCountdown(target, now);

  if (c.isPast) {
    return (
      <div className="countdown--past fade-in">
        <p className="countdown__headline">{t('departed')}</p>
        <p className="body">{t('departedSub')}</p>
      </div>
    );
  }

  const cells: Array<{ value: number; label: string; pad: number }> = [
    { value: c.days, label: t('countdownDays'), pad: 1 },
    { value: c.hours, label: t('countdownHours'), pad: 2 },
    { value: c.minutes, label: t('countdownMinutes'), pad: 2 },
    { value: c.seconds, label: t('countdownSeconds'), pad: 2 },
  ];

  // Seconds are deliberately left out of the spoken label: a screen reader
  // announcing a new value every second would make the page unusable.
  const spoken = `${c.days} ${t('countdownDays')}, ${c.hours} ${t(
    'countdownHours',
  )}, ${c.minutes} ${t('countdownMinutes')}`;

  return (
    <div className="countdown" role="timer" aria-label={spoken}>
      {cells.map((cell) => (
        <div className="countdown__cell" key={cell.label}>
          <span className="countdown__value" aria-hidden="true">
            {String(cell.value).padStart(cell.pad, '0')}
          </span>
          <span className="countdown__label" aria-hidden="true">
            {cell.label}
          </span>
        </div>
      ))}
    </div>
  );
}
