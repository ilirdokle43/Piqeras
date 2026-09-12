import { useMemo, useState } from 'react';
import { useT } from '../i18n';
import { useDates } from '../lib/useDates';
import { useAuth } from '../state/auth';
import {
  useCurrentTrip,
  useApprovedMembers,
  useMembers,
  useNow,
  useOnline,
  usePendingMembers,
  useResponses,
} from '../lib/hooks';
import {
  countsAsAttendee,
  effectiveDeparture,
  isDateConfirmed,
  isVotingOpen,
} from '../lib/domain';
import { Background } from '../components/Background';
import { Countdown } from '../components/Countdown';
import { Banner, EmptyState, SkeletonBlock } from '../components/ui';
import { SettingsSheet } from '../components/SettingsSheet';
import type { Route } from '../lib/router';
import { ShareButton } from '../components/ShareButton';
import { TripShareCard } from '../components/TripShareCard';

export function HomeScreen({ navigate }: { navigate: (route: Route) => void }) {
  const t = useT();
  const dates = useDates();
  const { uid, isOrganizer, profile } = useAuth();
  const now = useNow();
  const online = useOnline();
  const [settingsOpen, setSettingsOpen] = useState(false);

  const { data: trip, loading, error } = useCurrentTrip();
  const { data: responses } = useResponses(trip?.id ?? null);
  const { data: members } = useMembers();
  // The roster the share card names: `members` also holds accounts still
  // waiting for approval, who are not part of the group yet.
  const { data: approvedMembers } = useApprovedMembers();
  // Organizers only; the rules deny everyone else the approval queue.
  const { data: pending } = usePendingMembers(isOrganizer);

  const myResponse = useMemo(
    () => responses.find((r) => r.uid === uid) ?? null,
    [responses, uid],
  );

  const departure = trip ? effectiveDeparture(trip) : null;

  /**
   * The departure THIS phone is about.
   *
   * Not everybody leaves together — the group routinely spreads across three
   * departures — so once you have picked a time, the date at the top and the
   * countdown under it are both about when *you* go. Until then they are the
   * trip's own departure.
   *
   * Somebody who answered "not coming" has no departure of their own, so they
   * see the trip's, which is also what they need if they change their mind.
   */
  const myDeparture =
    myResponse && countsAsAttendee(myResponse.attendance)
      ? myResponse.preferredDeparture
      : null;
  const showing = myDeparture ?? departure;
  /** True once your own departure has moved the header away from the trip's. */
  const showingMine =
    myDeparture != null && departure != null &&
    myDeparture.getTime() !== departure.getTime();
  const confirmed = trip ? isDateConfirmed(trip) : false;
  const votingOpen = trip ? isVotingOpen(trip, now) : false;

  // "No response" is the roster minus everyone who has answered, never a
  // negative number if a response outlives the user document that made it.
  const noResponseCount = trip
    ? Math.max(0, members.length - responses.length)
    : 0;

  return (
    <>
      <Background imageUrl={trip?.backgroundImageUrl ?? null} />

      <main className="screen">
        <div className="column">
          {!online && <Banner tone="warn" sticky>{t('offline')}</Banner>}

          {isOrganizer && pending.length > 0 && (
            <button
              type="button"
              onClick={() => navigate({ name: 'organizer' })}
              style={{ display: 'block', width: '100%', textAlign: 'left' }}
            >
              <Banner tone="warn">{t('pendingAlert', { count: pending.length })}</Banner>
            </button>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            {/* On this screen the share button sends a composed card — the
                countdown plus who is travelling when — rather than a photograph
                of buttons nobody can tap. */}
            <ShareButton
              renderCard={
                trip && departure
                  ? () => (
                      <TripShareCard
                        trip={trip}
                        departure={departure}
                        now={now}
                        responses={responses}
                        members={approvedMembers}
                      />
                    )
                  : undefined
              }
            />
            <button
              type="button"
              className="icon-btn"
              style={{ marginInlineStart: 0, marginInlineEnd: 'calc(var(--sp-3) * -1)' }}
              onClick={() => setSettingsOpen(true)}
              aria-label={t('changeNameAction')}
              data-capture-hide
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="12" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.8" />
                <path
                  d="M4.5 19.5c1.2-3.2 4-4.8 7.5-4.8s6.3 1.6 7.5 4.8"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>

          <div className="spacer" />

          {loading && !trip && (
            <div className="stack" aria-busy="true">
              <SkeletonBlock height={22} width="45%" />
              <SkeletonBlock height={64} width="70%" />
              <SkeletonBlock height={96} />
            </div>
          )}

          {!loading && error != null && (
            <Banner tone="error">{t('genericError')}</Banner>
          )}

          {!loading && !error && !trip && (
            <div className="panel">
              <EmptyState icon="🌅" title={t('noTripTitle')} body={t('noTripBody')} />
            </div>
          )}

          {trip && departure && showing && (
            <>
              <section className="stack stack--tight fade-in">
                <p className="eyebrow">{trip.destination || t('appName')}</p>
                <h1 className="hero-title">{trip.title}</h1>
                <p className="hero-date">{dates.dayMonth(showing)}</p>
              </section>

              <div
                className="stack stack--tight"
                style={{ marginTop: 'var(--sp-4)', marginBottom: 'var(--sp-5)' }}
              >
                <p className="body body--tight">{dates.full(showing)}</p>
                {/* Only when this reader's clock actually disagrees with the
                    trip's own — otherwise it is a line of noise. */}
                {dates.differsFromTripZone(showing) && (
                  <p className="muted">{t('timeZoneNotice')}</p>
                )}
                <div className="summary">
                  <span className={`chip ${confirmed ? 'chip--live' : ''}`}>
                    {confirmed ? t('dateConfirmed') : t('dateBeingVoted')}
                  </span>
                  {trip.status === 'cancelled' && (
                    <span className="chip chip--locked">{t('statusCancelled')}</span>
                  )}
                  {!votingOpen && trip.status !== 'cancelled' && (
                    <span className="chip chip--locked">{t('votingClosed')}</span>
                  )}
                </div>
              </div>

              <Countdown target={dates.countdownTarget(showing)} now={now} />

              {/* Your own time now heads the screen, so the trip's takes the
                  supporting line — the group's plan should not vanish just
                  because you are leaving at a different hour. */}
              {showingMine && (
                <p className="muted" style={{ marginTop: 'var(--sp-2)' }}>
                  {confirmed ? t('dateConfirmed') : t('proposedDate')}:{' '}
                  {dates.full(departure)}
                </p>
              )}

              {trip.status === 'cancelled' && (
                <div style={{ marginTop: 'var(--sp-5)' }}>
                  <Banner tone="warn">{t('tripCancelledNotice')}</Banner>
                </div>
              )}

              <div className="spacer" />

              <section className="panel stack" style={{ marginBottom: 'var(--sp-4)' }}>
                <div className="summary">
                  <span className="chip chip--yes">
                    <span className="chip__dot" />
                    {t('attendanceYesShort')}
                    <span className="chip__count">{trip.responseCounts.yes}</span>
                  </span>
                  <span className="chip chip--maybe">
                    <span className="chip__dot" />
                    {t('attendanceMaybeShort')}
                    <span className="chip__count">{trip.responseCounts.maybe}</span>
                  </span>
                  <span className="chip chip--no">
                    <span className="chip__dot" />
                    {t('attendanceNoShort')}
                    <span className="chip__count">{trip.responseCounts.no}</span>
                  </span>
                  <span className="chip chip--none">
                    <span className="chip__dot" />
                    {t('noResponse')}
                    <span className="chip__count">{noResponseCount}</span>
                  </span>
                </div>

                {votingOpen && trip.votingDeadline && (
                  <p className="muted">
                    {t('votingClosesAt', { date: dates.full(trip.votingDeadline) })}
                  </p>
                )}
              </section>

              <div className="stack stack--tight">
                <button
                  type="button"
                  className="btn btn--primary btn--block"
                  onClick={() => navigate({ name: 'respond' })}
                  disabled={trip.status === 'cancelled'}
                >
                  {myResponse ? t('changeResponseAction') : t('respondAction')}
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--block"
                  onClick={() => navigate({ name: 'responses' })}
                >
                  {t('viewAllAction')}
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--block"
                  onClick={() => navigate({ name: 'history' })}
                >
                  {t('historyAction')}
                </button>
                {isOrganizer && (
                  <button
                    type="button"
                    className="btn btn--quiet btn--block"
                    onClick={() => navigate({ name: 'organizer' })}
                  >
                    {t('organizerAction')}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </main>

      {settingsOpen && (
        <SettingsSheet currentName={profile?.displayName ?? ''} onClose={() => setSettingsOpen(false)} />
      )}
    </>
  );
}
