import { useMemo, useState } from 'react';
import { useT } from '../i18n';
import { useDates } from '../lib/useDates';
import { useAuth } from '../state/auth';
import { useMembers, useOnline, useResponses, useCurrentTrip } from '../lib/hooks';
import {
  exactSlotKey,
  type Attendance,
} from '../lib/domain';
import type { TripResponse } from '../lib/types';
import { Background } from '../components/Background';
import { AppBar, Avatar, Banner, EmptyState, SkeletonBlock } from '../components/ui';

type Mode = 'time' | 'status';

interface Slot {
  key: string;
  instant: Date;
  people: TripResponse[];
}

export function GroupResponsesScreen({ onBack }: { onBack: () => void }) {
  const t = useT();
  const dates = useDates();
  const { uid } = useAuth();
  const online = useOnline();
  const [mode, setMode] = useState<Mode>('time');

  const { data: trip } = useCurrentTrip();
  const { data: responses, loading } = useResponses(trip?.id ?? null);
  const { data: members } = useMembers();

  const byAttendance = useMemo(() => {
    const buckets: Record<Attendance, TripResponse[]> = { yes: [], maybe: [], no: [] };
    for (const r of responses) buckets[r.attendance]?.push(r);
    for (const list of Object.values(buckets)) {
      list.sort(
        (a, b) =>
          (a.preferredDeparture?.getTime() ?? 0) - (b.preferredDeparture?.getTime() ?? 0) ||
          a.displayName.localeCompare(b.displayName),
      );
    }
    return buckets;
  }, [responses]);

  /** Members who have not answered at all — the roster minus the responders. */
  const silent = useMemo(() => {
    const responded = new Set(responses.map((r) => r.uid));
    return members
      .filter((m) => !responded.has(m.uid))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [members, responses]);

  /**
   * Departure slots, chronological.
   *
   * Grouping is on the *local* wall-clock key rather than the raw instant, so
   * two people who both picked 06:00 land together even if their devices are in
   * different timezones.
   *
   * The key stays in the trip's own zone deliberately — it must not depend on
   * who is looking, or the group would split differently for a Greek reader
   * than for an Albanian one. Only the label follows the reader's clock.
   */
  const slots = useMemo<Slot[]>(() => {
    const map = new Map<string, Slot>();
    for (const r of [...byAttendance.yes, ...byAttendance.maybe]) {
      if (!r.preferredDeparture) continue;
      const key = exactSlotKey(r.preferredDeparture);
      const slot = map.get(key);
      if (slot) {
        slot.people.push(r);
      } else {
        map.set(key, { key, instant: r.preferredDeparture, people: [r] });
      }
    }
    return [...map.values()].sort((a, b) => a.instant.getTime() - b.instant.getTime());
  }, [byAttendance]);

  const isEmpty = responses.length === 0 && silent.length === 0;

  return (
    <>
      <Background imageUrl={trip?.backgroundImageUrl ?? null} />

      <main className="screen">
        <div className="column">
          <AppBar title={t('groupTitle')} onBack={onBack} />

          {!online && <Banner tone="warn" sticky>{t('offline')}</Banner>}

          <div className="btn-row" style={{ marginBottom: 'var(--sp-4)' }}>
            <button
              type="button"
              className={`btn ${mode === 'time' ? 'btn--primary' : 'btn--ghost'}`}
              onClick={() => setMode('time')}
              aria-pressed={mode === 'time'}
            >
              {t('groupByTime')}
            </button>
            <button
              type="button"
              className={`btn ${mode === 'status' ? 'btn--primary' : 'btn--ghost'}`}
              onClick={() => setMode('status')}
              aria-pressed={mode === 'status'}
            >
              {t('groupByStatus')}
            </button>
          </div>

          {loading && responses.length === 0 && (
            <div className="stack" aria-busy="true">
              <SkeletonBlock height={64} />
              <SkeletonBlock height={64} />
              <SkeletonBlock height={64} />
            </div>
          )}

          {!loading && isEmpty && (
            <div className="panel">
              <EmptyState
                icon="🕗"
                title={t('noResponsesYet')}
                body={t('noResponsesYetSub')}
              />
            </div>
          )}

          {!isEmpty && mode === 'time' && (
            <div className="stack">
              {slots.map((slot) => (
                <section className="panel" key={slot.key}>
                  <div className="group__head">
                    <div>
                      <p className="group__time">{dates.time(slot.instant)}</p>
                      <p className="group__day">{dates.dayMonth(slot.instant)}</p>
                    </div>
                    <span className="chip chip--live">
                      {t('chosenBy', { count: slot.people.length })}
                    </span>
                  </div>
                  <div className="group">
                    {slot.people.map((person) => (
                      <PersonRow key={person.uid} person={person} me={person.uid === uid} showTime={false} />
                    ))}
                  </div>
                </section>
              ))}

              {byAttendance.no.length > 0 && (
                <Section title={t('groupNotComing')} count={byAttendance.no.length}>
                  {byAttendance.no.map((person) => (
                    <PersonRow key={person.uid} person={person} me={person.uid === uid} showTime={false} />
                  ))}
                </Section>
              )}

              {silent.length > 0 && (
                <Section title={t('groupNoResponse')} count={silent.length}>
                  {silent.map((member) => (
                    <div className={`person${member.uid === uid ? ' person--me' : ''}`} key={member.uid}>
                      <Avatar name={member.displayName} />
                      <div className="person__main">
                        <p className="person__name">
                          {member.displayName}
                          {member.uid === uid && <span className="muted"> · {t('youLabel')}</span>}
                        </p>
                      </div>
                    </div>
                  ))}
                </Section>
              )}
            </div>
          )}

          {!isEmpty && mode === 'status' && (
            <div className="stack">
              <Section title={t('groupComing')} count={byAttendance.yes.length}>
                {byAttendance.yes.map((person) => (
                  <PersonRow key={person.uid} person={person} me={person.uid === uid} showTime />
                ))}
              </Section>
              <Section title={t('groupMaybe')} count={byAttendance.maybe.length}>
                {byAttendance.maybe.map((person) => (
                  <PersonRow key={person.uid} person={person} me={person.uid === uid} showTime />
                ))}
              </Section>
              <Section title={t('groupNotComing')} count={byAttendance.no.length}>
                {byAttendance.no.map((person) => (
                  <PersonRow key={person.uid} person={person} me={person.uid === uid} showTime={false} />
                ))}
              </Section>
              <Section title={t('groupNoResponse')} count={silent.length}>
                {silent.map((member) => (
                  <div className={`person${member.uid === uid ? ' person--me' : ''}`} key={member.uid}>
                    <Avatar name={member.displayName} />
                    <div className="person__main">
                      <p className="person__name">
                        {member.displayName}
                        {member.uid === uid && <span className="muted"> · {t('youLabel')}</span>}
                      </p>
                    </div>
                  </div>
                ))}
              </Section>
            </div>
          )}
        </div>
      </main>
    </>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  const t = useT();
  if (count === 0) {
    return (
      <section className="panel">
        <div className="panel__header">
          <p className="section-title">{title}</p>
          <span className="muted">0</span>
        </div>
        <p className="muted">{t('noResponsesYet')}</p>
      </section>
    );
  }
  return (
    <section className="panel">
      <div className="panel__header">
        <p className="section-title">{title}</p>
        <span className="chip">
          {count === 1 ? t('personCount') : t('peopleCount', { count })}
        </span>
      </div>
      <div className="group">{children}</div>
    </section>
  );
}

function PersonRow({
  person,
  me,
  showTime,
}: {
  person: TripResponse;
  me: boolean;
  showTime: boolean;
}) {
  const t = useT();
  const dates = useDates();
  return (
    <div className={`person${me ? ' person--me' : ''}`}>
      <Avatar name={person.displayName} />
      <div className="person__main">
        <p className="person__name">
          {person.displayName}
          {me && <span className="muted"> · {t('youLabel')}</span>}
        </p>
        {person.note && <p className="person__note">{person.note}</p>}
        {person.updatedAt && (
          <p className="person__note">{t('updatedAt', { date: dates.full(person.updatedAt) })}</p>
        )}
      </div>
      {showTime && person.preferredDeparture && (
        <div className="person__meta">
          <p className="person__time">{dates.time(person.preferredDeparture)}</p>
          <p className="muted">{dates.dayMonth(person.preferredDeparture)}</p>
        </div>
      )}
    </div>
  );
}
