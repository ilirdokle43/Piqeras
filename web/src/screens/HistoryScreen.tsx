import { useT } from '../i18n';
import { useDates } from '../lib/useDates';
import { useHistory } from '../lib/hooks';
import { sortTripsNewestFirst } from '../lib/domain';
import type { Trip } from '../lib/types';
import { Background } from '../components/Background';
import { AppBar, EmptyState, SkeletonBlock } from '../components/ui';

/**
 * Historiku — every trip that actually happened, newest first.
 *
 * Only `completed` and `archived` trips reach here. A cancelled trip never
 * appears: it stays readable, but a trip that did not happen is not history.
 */
export function HistoryScreen({
  onBack,
  onOpenTrip,
}: {
  onBack: () => void;
  onOpenTrip: (tripId: string) => void;
}) {
  const t = useT();
  const { data: trips, loading } = useHistory();
  const ordered = sortTripsNewestFirst(trips);

  return (
    <>
      <Background imageUrl={ordered[0]?.backgroundImageUrl ?? null} />

      <main className="screen">
        <div className="column">
          <AppBar title={t('historyTitle')} onBack={onBack} />

          {loading && trips.length === 0 && (
            <div className="stack" aria-busy="true">
              <SkeletonBlock height={140} />
              <SkeletonBlock height={140} />
            </div>
          )}

          {!loading && ordered.length === 0 && (
            <div className="panel">
              <EmptyState icon="🌊" title={t('historyEmpty')} body={t('historyEmptyHint')} />
            </div>
          )}

          <div className="history-grid">
            {ordered.map((trip) => (
              <HistoryCard key={trip.id} trip={trip} onOpen={() => onOpenTrip(trip.id)} />
            ))}
          </div>
        </div>
      </main>
    </>
  );
}

function HistoryCard({ trip, onOpen }: { trip: Trip; onOpen: () => void }) {
  const t = useT();
  const dates = useDates();

  const attendees =
    trip.attendeeCount === 1
      ? t('historyAttendeesOne')
      : trip.attendeeCount > 0
        ? t('historyAttendees', { count: trip.attendeeCount })
        : t('historyNoAttendees');

  return (
    <button type="button" className="history-card" onClick={onOpen}>
      <span
        className="history-card__cover"
        style={
          trip.backgroundImageUrl
            ? { backgroundImage: `url(${JSON.stringify(trip.backgroundImageUrl)})` }
            : undefined
        }
        aria-hidden="true"
      />

      <span className="history-card__body">
        <span className="history-card__head">
          <span className="history-card__title">{trip.title}</span>
          <span className="chip chip--locked">{t('historyCompleted')}</span>
        </span>

        {/* Precision-aware: a date-only trip never shows an invented time. */}
        <span className="history-card__date">
          {dates.tripDate(trip.proposedDeparture, trip.datePrecision)}
        </span>

        {trip.description && (
          <span className="history-card__desc">{trip.description}</span>
        )}

        <span className="history-card__meta">{attendees}</span>
      </span>
    </button>
  );
}
