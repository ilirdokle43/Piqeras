import { useMemo } from 'react';
import { useT } from '../i18n';
import { useDates } from '../lib/useDates';
import { useAttendees, useTrip } from '../lib/hooks';
import {
  countsAsAttendee,
} from '../lib/domain';
import { Background } from '../components/Background';
import { AppBar, Avatar, Banner, EmptyState, SkeletonBlock } from '../components/ui';

/**
 * A past trip in full.
 *
 * Everything shown here comes from immutable attendee snapshots, not from live
 * profiles — so a friend who left the group, renamed themselves, or never had
 * an account at all still appears exactly as they did at the time.
 */
export function TripDetailScreen({
  tripId,
  onBack,
}: {
  tripId: string;
  onBack: () => void;
}) {
  const t = useT();
  const dates = useDates();
  const { data: trip, loading } = useTrip(tripId);
  const { data: attendees } = useAttendees(tripId);

  const came = useMemo(
    () =>
      attendees
        .filter((a) => countsAsAttendee(a.attendance))
        .sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [attendees],
  );

  // Departure choices only exist for trips that were voted on in the app.
  const choices = useMemo(
    () =>
      attendees
        .filter((a) => a.preferredDeparture)
        .sort(
          (a, b) =>
            (a.preferredDeparture?.getTime() ?? 0) - (b.preferredDeparture?.getTime() ?? 0),
        ),
    [attendees],
  );

  return (
    <>
      <Background imageUrl={trip?.backgroundImageUrl ?? null} />

      <main className="screen">
        <div className="column">
          <AppBar title={trip?.title ?? t('historyTitle')} onBack={onBack} />

          {loading && !trip && (
            <div className="stack" aria-busy="true">
              <SkeletonBlock height={80} />
              <SkeletonBlock height={160} />
            </div>
          )}

          {!loading && !trip && <Banner tone="info">{t('historyNotFound')}</Banner>}

          {trip && (
            <div className="stack">
              <section className="panel stack stack--tight">
                <div className="panel__header">
                  <p className="eyebrow">{trip.destination}</p>
                  <span
                    className={`chip ${trip.status === 'cancelled' ? 'chip--no' : 'chip--locked'}`}
                  >
                    {trip.status === 'cancelled'
                      ? t('statusCancelled')
                      : t('historyCompleted')}
                  </span>
                </div>

                <h1 style={{ fontSize: 'clamp(1.75rem, 7vw, 2.5rem)', fontWeight: 600 }}>
                  {trip.title}
                </h1>

                {/* Date-only trips render the date alone — never 00:00. */}
                <p className="body">
                  {dates.tripDate(trip.proposedDeparture, trip.datePrecision)}
                </p>

                {trip.status === 'cancelled' && (
                  <Banner tone="warn">{t('historyCancelled')}</Banner>
                )}

                {trip.datePrecision === 'dateOnly' ? (
                  <p className="muted">{t('historyDepartureUnknown')}</p>
                ) : (
                  trip.finalDeparture && (
                    <p className="muted">
                      {t('historyDeparture')}: {dates.time(trip.finalDeparture)}
                    </p>
                  )
                )}

                {trip.returnDate && (
                  <p className="muted">
                    {t('historyReturn')}: {dates.date(trip.returnDate)}
                  </p>
                )}

                {trip.description && <p className="body">{trip.description}</p>}
              </section>

              {trip.memory && (
                <section className="panel stack stack--tight">
                  <p className="section-title">{t('historyMemory')}</p>
                  <p className="body">{trip.memory}</p>
                </section>
              )}

              <section className="panel stack">
                <div className="panel__header">
                  <p className="section-title">{t('historyWhoCame')}</p>
                  <span className="chip">
                    {came.length === 1
                      ? t('historyAttendeesOne')
                      : t('historyAttendees', { count: came.length })}
                  </span>
                </div>

                {came.length === 0 && (
                  <EmptyState icon="👥" title={t('historyNoAttendees')} />
                )}

                <div className="group">
                  {came.map((person) => (
                    <div className="person" key={person.id}>
                      <Avatar name={person.displayName} />
                      <div className="person__main">
                        <p className="person__name">{person.displayName}</p>
                        {person.note && <p className="person__note">{person.note}</p>}
                        {person.attendance === 'maybe' && (
                          <p className="person__note">{t('attendanceMaybeShort')}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {choices.length > 0 && (
                <section className="panel stack">
                  <p className="section-title">{t('historyChoices')}</p>
                  <div className="group">
                    {choices.map((person) => (
                      <div className="person" key={`choice-${person.id}`}>
                        <div className="person__main">
                          <p className="person__name">{person.displayName}</p>
                        </div>
                        <div className="person__meta">
                          <p className="person__time">
                            {dates.time(person.preferredDeparture!)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </div>
          )}
        </div>
      </main>
    </>
  );
}
