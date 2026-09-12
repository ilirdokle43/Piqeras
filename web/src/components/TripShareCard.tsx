import { useMemo } from 'react';
import { useT } from '../i18n';
import { useDates } from '../lib/useDates';
import { countsAsAttendee, exactSlotKey, isDateConfirmed, isVotingOpen } from '../lib/domain';
import type { ApprovedMember, Trip, TripResponse } from '../lib/types';
import { PAINTED_SUNSET } from './Background';
import { Countdown } from './Countdown';

/**
 * The picture the share button sends.
 *
 * Deliberately not a crop of the home screen. The screen ends in a row of
 * counts and three buttons nobody can tap in a photograph; what the group
 * actually wants in the chat is the countdown and who is travelling when. So
 * this is composed for sharing: the same header and countdown, and in place of
 * the tally, everyone who is coming grouped by the departure they chose.
 *
 * The header is the sender's own departure, matching the screen they tapped
 * share on — the picture should say what they were looking at. The trip's own
 * departure keeps the supporting line beneath, and the list below names
 * everybody's times, so a recipient leaving at another hour still finds
 * themselves in it.
 *
 * It carries its own backdrop because the app's is a `position: fixed` layer
 * outside this subtree — an off-screen node would otherwise be drawn onto
 * nothing.
 */
export function TripShareCard({
  trip,
  departure,
  tripDeparture,
  now,
  responses,
  members,
}: {
  trip: Trip;
  /** What the header is about: the sender's own departure once they have voted. */
  departure: Date;
  /** The trip's own, for the supporting line when the two differ. */
  tripDeparture: Date;
  now: Date;
  responses: readonly TripResponse[];
  /** The approved roster, so the people who never answered can be named. */
  members: readonly ApprovedMember[];
}) {
  const t = useT();
  const dates = useDates();

  const confirmed = isDateConfirmed(trip);
  const votingOpen = isVotingOpen(trip, now);

  /**
   * Everyone travelling, by the departure they picked.
   *
   * Keyed in the trip's own zone, like the group screen, so the grouping does
   * not change with the reader's language — only the labels do.
   */
  const slots = useMemo(() => {
    const travelling = responses.filter((r) => countsAsAttendee(r.attendance));
    const byKey = new Map<string, { instant: Date; people: TripResponse[] }>();
    const undecided: TripResponse[] = [];

    for (const person of travelling) {
      if (!person.preferredDeparture) {
        undecided.push(person);
        continue;
      }
      const key = exactSlotKey(person.preferredDeparture);
      const slot = byKey.get(key);
      if (slot) slot.people.push(person);
      else byKey.set(key, { instant: person.preferredDeparture, people: [person] });
    }

    const ordered = [...byKey.values()].sort(
      (a, b) => a.instant.getTime() - b.instant.getTime(),
    );
    for (const slot of ordered) {
      slot.people.sort((a, b) => a.displayName.localeCompare(b.displayName));
    }
    undecided.sort((a, b) => a.displayName.localeCompare(b.displayName));

    return { ordered, undecided, total: travelling.length };
  }, [responses]);

  /**
   * The rest of the group: who said no, and who has not answered at all.
   *
   * The silent ones come from the approved roster minus everyone who replied —
   * `users` would do it too, but that collection also holds accounts still
   * waiting for approval, and a stranger's name on a shared card would be a
   * small leak of who is knocking at the door.
   */
  const rest = useMemo(() => {
    const answered = new Set(responses.map((r) => r.uid));
    return {
      notComing: responses
        .filter((r) => r.attendance === 'no')
        .map((r) => r.displayName)
        .sort((a, b) => a.localeCompare(b)),
      silent: members
        .filter((m) => !answered.has(m.uid))
        .map((m) => m.displayName)
        .sort((a, b) => a.localeCompare(b)),
    };
  }, [responses, members]);

  return (
    <div
      className="share-card"
      style={{
        backgroundImage: trip.backgroundImageUrl
          ? `url(${JSON.stringify(trip.backgroundImageUrl)})`
          : PAINTED_SUNSET,
      }}
    >
      <div className="share-card__scrim" />

      <div className="share-card__body">
        <div className="stack stack--tight">
          <p className="eyebrow">{trip.destination || t('appName')}</p>
          <h2 className="share-card__title">{trip.title}</h2>
          <p className="share-card__date">{dates.dayMonth(departure)}</p>
        </div>

        <div className="stack stack--tight">
          <p className="body body--tight">{dates.full(departure)}</p>
          {dates.differsFromTripZone(departure) && (
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

        <Countdown target={dates.countdownTarget(departure)} now={now} />

        {/* Only when the sender leaves at a different hour from the trip's
            own departure — otherwise it prints the same date twice. */}
        {departure.getTime() !== tripDeparture.getTime() && (
          <p className="muted">
            {confirmed ? t('dateConfirmed') : t('proposedDate')}:{' '}
            {dates.full(tripDeparture)}
          </p>
        )}

        <section className="share-card__who">
          <div className="panel__header">
            <p className="section-title">{t('shareWhoIsTravelling')}</p>
            <span className="chip">
              {slots.total === 1
                ? t('personCount')
                : t('peopleCount', { count: slots.total })}
            </span>
          </div>

          {slots.total === 0 && <p className="muted">{t('noResponsesYet')}</p>}

          <div className="share-slots">
            {slots.ordered.map((slot) => (
              <div className="share-slot" key={exactSlotKey(slot.instant)}>
                <div className="share-slot__when">
                  <span className="share-slot__time">{dates.time(slot.instant)}</span>
                  <span className="share-slot__day">{dates.dayMonth(slot.instant)}</span>
                </div>
                <p className="share-slot__names">
                  {slot.people
                    .map((p) =>
                      p.attendance === 'maybe'
                        ? `${p.displayName} (${t('attendanceMaybeShort')})`
                        : p.displayName,
                    )
                    .join(' · ')}
                </p>
              </div>
            ))}

            {slots.undecided.length > 0 && (
              <div className="share-slot">
                <div className="share-slot__when">
                  <span className="share-slot__time share-slot__time--unknown">—</span>
                  <span className="share-slot__day">{t('historyDepartureUnknown')}</span>
                </div>
                <p className="share-slot__names">
                  {slots.undecided.map((p) => p.displayName).join(' · ')}
                </p>
              </div>
            )}

            {/* Everyone else, so the card answers "who is still missing?"
                as well as "who is coming?" */}
            {rest.notComing.length > 0 && (
              <div className="share-slot share-slot--aside">
                <span className="share-slot__label">{t('groupNotComing')}</span>
                <p className="share-slot__names">{rest.notComing.join(' · ')}</p>
              </div>
            )}

            {rest.silent.length > 0 && (
              <div className="share-slot share-slot--aside">
                <span className="share-slot__label">{t('groupNoResponse')}</span>
                <p className="share-slot__names">{rest.silent.join(' · ')}</p>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
