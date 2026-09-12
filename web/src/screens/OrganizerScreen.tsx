import { useEffect, useMemo, useRef, useState } from 'react';
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';
import { useT } from '../i18n';
import { useDates } from '../lib/useDates';
import { useAuth } from '../state/auth';
import {
  useCurrentTrip,
  useMembers,
  useNow,
  useOnline,
  useApprovedMembers,
  useAttendees,
  useOrganizers,
  usePendingMembers,
  useResponses,
  useToast,
} from '../lib/hooks';
import {
  effectiveDeparture,
  isVotingOpen,
  tallyDepartureChoices,
  TRIP_STATUS_VALUES,
  type TripStatus,
} from '../lib/domain';
import {
  confirmFinalDate,
  createTrip,
  deleteResponseAsOrganizer,
  fetchTripHistory,
  completeTrip,
  manageMembership,
  manageOrganizer,
  refreshClaims,
  setTripBackground,
  setTripStatus,
  setVotingLocked,
  updateTrip,
  type TripInput,
} from '../lib/repo';
import { storage } from '../lib/firebase';
import type { Trip } from '../lib/types';
import { Background } from '../components/Background';
import { AppBar, Avatar, Banner, Modal, SkeletonBlock, Toast } from '../components/ui';
import { HistoricalTripForm } from '../components/HistoricalTripForm';

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

type Confirmation =
  | { kind: 'finalDate'; instant: Date }
  | { kind: 'cancelTrip' }
  | { kind: 'removeResponse'; uid: string; name: string }
  | { kind: 'removeOrganizer'; uid: string; name: string }
  | { kind: 'approve'; uid: string; name: string }
  | { kind: 'reject'; uid: string; name: string }
  | { kind: 'removeMember'; uid: string; name: string }
  | { kind: 'completeTrip' };

export function OrganizerScreen({ onBack }: { onBack: () => void }) {
  const t = useT();
  const dates = useDates();
  const { uid } = useAuth();
  const now = useNow(30_000);
  const online = useOnline();
  const [toast, showToast] = useToast();

  const { data: trip } = useCurrentTrip();
  const { data: responses } = useResponses(trip?.id ?? null);
  const { data: members } = useMembers();
  const { data: organizers } = useOrganizers();
  const { data: pending } = usePendingMembers(true);
  // "Anetaret" and the promote list must show people who are actually IN the
  // group. `members` (the users collection) also contains pending accounts, and
  // offering to promote one would fail server-side with a confusing error.
  const { data: approvedMembers } = useApprovedMembers(true);

  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<Trip[]>([]);
  const [historyForm, setHistoryForm] = useState<{ trip: Trip | null } | null>(null);
  // The editor replaces the attendee list wholesale, so it must be seeded with
  // the real one — handing it an empty array would silently erase everybody.
  const { data: editingAttendees, loading: attendeesLoading } = useAttendees(
    historyForm?.trip?.id ?? null,
  );
  // Asked explicitly before completing, never inferred.
  const [includeMaybe, setIncludeMaybe] = useState(false);

  useEffect(() => {
    fetchTripHistory()
      .then(setHistory)
      .catch(() => setHistory([]));
  }, [trip?.updatedAt]);

  const votingOpen = trip ? isVotingOpen(trip, now) : false;

  const tally = useMemo(
    () =>
      tallyDepartureChoices(
        responses.map((r) => ({
          uid: r.uid,
          attendance: r.attendance,
          preferredDeparture: r.preferredDeparture,
        })),
      ),
    [responses],
  );
  const topCount = tally[0]?.count ?? 0;

  const organizerUids = useMemo(() => new Set(organizers.map((o) => o.uid)), [organizers]);

  async function run(action: () => Promise<void>, successKey?: 'tripSaved') {
    setBusy(true);
    setError(null);
    try {
      await action();
      if (successKey) showToast(t(successKey));
    } catch (err) {
      const message =
        typeof err === 'object' && err && 'message' in err
          ? String((err as { message?: string }).message)
          : '';
      setError(
        message.includes('organizatori i fundit')
          ? t('lastOrganizerError')
          : message.includes('rolin e organizatorit')
            ? t('removeOrganizerFirst')
            : t('tripSaveFailed'),
      );
    } finally {
      setBusy(false);
      setConfirmation(null);
    }
  }

  async function onConfirm() {
    if (!confirmation || !trip || !uid) return;
    switch (confirmation.kind) {
      case 'finalDate':
        return run(() => confirmFinalDate(trip.id, confirmation.instant, uid), 'tripSaved');
      case 'cancelTrip':
        return run(
          () => setTripStatus(trip.id, 'cancelled', uid, { isCurrent: false }),
          'tripSaved',
        );
      case 'removeResponse':
        return run(() => deleteResponseAsOrganizer(trip.id, confirmation.uid));
      case 'removeOrganizer':
        return run(() => manageOrganizer(confirmation.uid, 'revoke'));
      case 'approve':
        return run(() => manageMembership(confirmation.uid, 'approve'));
      case 'reject':
        return run(() => manageMembership(confirmation.uid, 'reject'));
      case 'removeMember':
        return run(() => manageMembership(confirmation.uid, 'remove'));
      case 'completeTrip':
        return run(async () => {
          await completeTrip(trip.id, includeMaybe);
          showToast(t('completeTripDone'));
        });
    }
  }

  return (
    <>
      <Background imageUrl={trip?.backgroundImageUrl ?? null} />

      <main className="screen">
        <div className="column">
          <AppBar title={t('organizerTitle')} onBack={onBack} />

          {!online && <Banner tone="warn" sticky>{t('offline')}</Banner>}
          {error && <Banner tone="error">{error}</Banner>}

          <div className="stack">
            <TripForm
              trip={trip}
              busy={busy}
              onSaved={() => showToast(t('tripSaved'))}
              onError={() => setError(t('tripSaveFailed'))}
            />

            {trip && (
              <>
                <section className="panel stack">
                  <div className="panel__header">
                    <p className="section-title">{t('statusLabel')}</p>
                    <span className={`chip ${votingOpen ? 'chip--live' : 'chip--locked'}`}>
                      {votingOpen ? t('votingOpen') : t('votingClosed')}
                    </span>
                  </div>

                  <p className="body body--tight">
                    {trip.finalDeparture
                      ? `${t('dateConfirmed')}: ${dates.full(trip.finalDeparture)}`
                      : `${t('proposedDate')}: ${dates.full(trip.proposedDeparture)}`}
                  </p>
                  {trip.votingDeadline && (
                    <p className="muted">
                      {t('votingClosesAt', { date: dates.full(trip.votingDeadline) })}
                    </p>
                  )}

                  <div className="btn-row">
                    <button
                      type="button"
                      className="btn btn--ghost"
                      disabled={busy || !uid}
                      onClick={() =>
                        uid && run(() => setVotingLocked(trip.id, !trip.votingLocked, uid))
                      }
                    >
                      {trip.votingLocked ? t('unlockVotingAction') : t('lockVotingAction')}
                    </button>
                    <button
                      type="button"
                      className="btn btn--danger"
                      disabled={busy || trip.status === 'cancelled'}
                      onClick={() => setConfirmation({ kind: 'cancelTrip' })}
                    >
                      {t('cancelTripAction')}
                    </button>
                  </div>

                  <button
                    type="button"
                    className="btn btn--primary btn--block"
                    disabled={busy || trip.status === 'cancelled'}
                    onClick={() => setConfirmation({ kind: 'completeTrip' })}
                  >
                    {t('completeTripAction')}
                  </button>
                </section>

                <section className="panel stack">
                  <p className="section-title">{t('popularChoices')}</p>
                  {tally.length === 0 && <p className="muted">{t('noResponsesYet')}</p>}
                  <div className="tally">
                    {tally.map((entry) => (
                      <div key={entry.key}>
                        <div className="tally__row">
                          <span className="tally__time">
                            {dates.dayMonth(entry.instant)} {dates.time(entry.instant)}
                          </span>
                          <span className="tally__bar">
                            <span
                              className="tally__fill"
                              style={{
                                width: `${topCount ? (entry.count / topCount) * 100 : 0}%`,
                              }}
                            />
                          </span>
                          <span className="tally__count">{entry.count}</span>
                        </div>
                        <button
                          type="button"
                          className="btn btn--quiet"
                          style={{ paddingInline: 0 }}
                          disabled={busy}
                          onClick={() =>
                            setConfirmation({ kind: 'finalDate', instant: entry.instant })
                          }
                        >
                          {t('confirmDateAction')}
                        </button>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="panel stack">
                  <div className="panel__header">
                    <p className="section-title">{t('groupTitle')}</p>
                    <span className="chip">{responses.length}</span>
                  </div>
                  <div className="group">
                    {responses.length === 0 && <p className="muted">{t('noResponsesYet')}</p>}
                    {responses.map((r) => (
                      <div className="person" key={r.uid}>
                        <Avatar name={r.displayName} />
                        <div className="person__main">
                          <p className="person__name">{r.displayName}</p>
                          <p className="person__note">
                            {r.attendance === 'yes'
                              ? t('attendanceYesShort')
                              : r.attendance === 'maybe'
                                ? t('attendanceMaybeShort')
                                : t('attendanceNoShort')}
                            {r.preferredDeparture &&
                              ` · ${dates.dayMonth(r.preferredDeparture)} ${dates.time(
                                r.preferredDeparture,
                              )}`}
                          </p>
                          {r.note && <p className="person__note">{r.note}</p>}
                        </div>
                        <button
                          type="button"
                          className="btn btn--quiet"
                          disabled={busy}
                          onClick={() =>
                            setConfirmation({
                              kind: 'removeResponse',
                              uid: r.uid,
                              name: r.displayName,
                            })
                          }
                        >
                          {t('removeOrganizerAction')}
                        </button>
                      </div>
                    ))}
                  </div>
                </section>
              </>
            )}

            <section className="panel stack">
              <div className="panel__header">
                <p className="section-title">{t('approvalsTitle')}</p>
                <span className={`chip ${pending.length > 0 ? 'chip--live' : ''}`}>
                  {t('pendingCount', { count: pending.length })}
                </span>
              </div>

              {pending.length === 0 && <p className="muted">{t('noPendingRequests')}</p>}

              <div className="group">
                {pending.map((p) => {
                  // The chosen display name if they picked one, otherwise what
                  // Google reports. Both are server-derived, never client input.
                  const chosen = members.find((m) => m.uid === p.uid)?.displayName;
                  const label = chosen || p.googleName || p.emailMasked;
                  return (
                    <div className="person" key={p.uid}>
                      <Avatar name={label} />
                      <div className="person__main">
                        <p className="person__name">{label}</p>
                        <p className="person__note">
                          {p.googleName && chosen ? `${p.googleName} · ` : ''}
                          {p.emailMasked}
                        </p>
                      </div>
                      <div style={{ display: 'flex', gap: 'var(--sp-2)', flex: 'none' }}>
                        <button
                          type="button"
                          className="btn btn--quiet"
                          disabled={busy}
                          onClick={() =>
                            setConfirmation({ kind: 'reject', uid: p.uid, name: label })
                          }
                        >
                          {t('rejectAction')}
                        </button>
                        <button
                          type="button"
                          className="btn btn--quiet"
                          style={{ color: 'var(--sun-300)' }}
                          disabled={busy}
                          onClick={() =>
                            setConfirmation({ kind: 'approve', uid: p.uid, name: label })
                          }
                        >
                          {t('approveAction')}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="panel stack">
              <div className="panel__header">
                <p className="section-title">{t('membersTitle')}</p>
                <span className="chip">{approvedMembers.length}</span>
              </div>
              <div className="group">
                {approvedMembers.map((m) => (
                  <div className="person" key={m.uid}>
                    <Avatar name={m.displayName} />
                    <div className="person__main">
                      <p className="person__name">{m.displayName}</p>
                      {organizerUids.has(m.uid) && (
                        <p className="person__note">{t('manageOrganizers')}</p>
                      )}
                    </div>
                    {m.uid !== uid && (
                      <button
                        type="button"
                        className="btn btn--quiet"
                        disabled={busy}
                        onClick={() =>
                          setConfirmation({
                            kind: 'removeMember',
                            uid: m.uid,
                            name: m.displayName,
                          })
                        }
                      >
                        {t('removeMemberAction')}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </section>

            <section className="panel stack">
              <div className="panel__header">
                <p className="section-title">{t('manageOrganizers')}</p>
                <span className="chip">{organizers.length}</span>
              </div>
              <div className="group">
                {organizers.map((o) => (
                  <div className="person" key={o.uid}>
                    <Avatar name={o.displayName} />
                    <div className="person__main">
                      <p className="person__name">{o.displayName}</p>
                    </div>
                    <button
                      type="button"
                      className="btn btn--quiet"
                      disabled={busy || organizers.length <= 1}
                      onClick={() =>
                        setConfirmation({
                          kind: 'removeOrganizer',
                          uid: o.uid,
                          name: o.displayName,
                        })
                      }
                    >
                      {t('removeOrganizerAction')}
                    </button>
                  </div>
                ))}
              </div>

              <div className="field">
                <span className="field__label">{t('addOrganizerAction')}</span>
                <div className="group">
                  {approvedMembers
                    .filter((m) => !organizerUids.has(m.uid))
                    .map((m) => (
                      <div className="person" key={m.uid}>
                        <Avatar name={m.displayName} />
                        <div className="person__main">
                          <p className="person__name">{m.displayName}</p>
                        </div>
                        <button
                          type="button"
                          className="btn btn--quiet"
                          disabled={busy}
                          onClick={() => run(() => manageOrganizer(m.uid, 'grant'))}
                        >
                          {t('addOrganizerAction')}
                        </button>
                      </div>
                    ))}
                </div>
              </div>
            </section>

            {historyForm && historyForm.trip && attendeesLoading ? (
              <section className="panel stack">
                <p className="section-title">{t('editPastTripAction')}</p>
                <SkeletonBlock height={220} />
              </section>
            ) : historyForm ? (
              <HistoricalTripForm
                trip={historyForm.trip}
                existingAttendees={editingAttendees}
                members={members}
                onSaved={() => {
                  setHistoryForm(null);
                  showToast(t('historySaved'));
                  fetchTripHistory().then(setHistory).catch(() => {});
                }}
                onCancel={() => setHistoryForm(null)}
              />
            ) : (
              <button
                type="button"
                className="btn btn--ghost btn--block"
                onClick={() => setHistoryForm({ trip: null })}
              >
                {t('addPastTripAction')}
              </button>
            )}

            <section className="panel stack">
              <p className="section-title">{t('previousTrips')}</p>
              {history.filter((h) => h.id !== trip?.id).length === 0 && (
                <p className="muted">{t('noPreviousTrips')}</p>
              )}
              <div className="group">
                {history
                  .filter((h) => h.id !== trip?.id)
                  .map((h) => (
                    <div className="person" key={h.id}>
                      <div className="person__main">
                        <p className="person__name">{h.title}</p>
                        <p className="person__note">
                          {dates.full(effectiveDeparture(h))} · {statusLabel(h.status, t)}
                        </p>
                      </div>
                      <button
                        type="button"
                        className="btn btn--quiet"
                        disabled={busy}
                        onClick={() => setHistoryForm({ trip: h })}
                      >
                        {t('editPastTripAction')}
                      </button>
                      {h.status !== 'archived' && (
                        <button
                          type="button"
                          className="btn btn--quiet"
                          disabled={busy || !uid}
                          onClick={() =>
                            uid &&
                            run(() => setTripStatus(h.id, 'archived', uid, { isCurrent: false }))
                          }
                        >
                          {t('archiveTripAction')}
                        </button>
                      )}
                    </div>
                  ))}
              </div>
            </section>
          </div>
        </div>
      </main>

      {confirmation && (
        <Modal
          title={confirmationTitle(confirmation, t)}
          body={
            confirmation.kind === 'completeTrip' ? (
              <span>
                {t('completeTripBody')}
                <br />
                <br />
                <label className="choice" style={{ minHeight: 44 }}>
                  <input
                    type="checkbox"
                    checked={includeMaybe}
                    onChange={(e) => setIncludeMaybe(e.target.checked)}
                  />
                  <span className="choice__text">{t('completeTripIncludeMaybe')}</span>
                </label>
              </span>
            ) : (
              confirmationBody(confirmation, t, dates)
            )
          }
          confirmLabel={t('confirmAction')}
          tone={
            confirmation.kind === 'finalDate' || confirmation.kind === 'approve'
              ? 'primary'
              : 'danger'
          }
          busy={busy}
          onConfirm={onConfirm}
          onCancel={() => setConfirmation(null)}
        />
      )}

      <Toast message={toast} />
    </>
  );
}

function statusLabel(status: TripStatus, t: ReturnType<typeof useT>): string {
  const key = `status${status.charAt(0).toUpperCase()}${status.slice(1)}` as
    | 'statusDraft'
    | 'statusVoting'
    | 'statusConfirmed'
    | 'statusCompleted'
    | 'statusCancelled'
    | 'statusArchived';
  return t(key);
}

function confirmationTitle(c: Confirmation, t: ReturnType<typeof useT>): string {
  switch (c.kind) {
    case 'finalDate':
      return t('confirmDateTitle');
    case 'cancelTrip':
      return t('cancelTripTitle');
    case 'removeResponse':
      return t('removeResponseTitle');
    case 'removeOrganizer':
      return t('removeOrganizerTitle');
    case 'approve':
      return t('approveTitle');
    case 'reject':
      return t('rejectTitle');
    case 'removeMember':
      return t('removeMemberTitle');
    case 'completeTrip':
      return t('completeTripTitle');
  }
}

function confirmationBody(
  c: Confirmation,
  t: ReturnType<typeof useT>,
  dates: ReturnType<typeof useDates>,
): string {
  switch (c.kind) {
    case 'finalDate':
      return t('confirmDateBody', { date: dates.full(c.instant) });
    case 'cancelTrip':
      return t('cancelTripBody');
    case 'removeResponse':
      return t('removeResponseBody', { name: c.name });
    case 'removeOrganizer':
      return t('removeOrganizerBody', { name: c.name });
    case 'approve':
      return t('approveBody', { name: c.name });
    case 'reject':
      return t('rejectBody', { name: c.name });
    case 'removeMember':
      return t('removeMemberBody', { name: c.name });
    case 'completeTrip':
      return t('completeTripBody');
  }
}

/* ------------------------------------------------------------- trip form */

function TripForm({
  trip,
  busy,
  onSaved,
  onError,
}: {
  trip: Trip | null;
  busy: boolean;
  onSaved: () => void;
  onError: () => void;
}) {
  const t = useT();
  const dates = useDates();
  const { uid } = useAuth();
  const fileInput = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState('Piqeras');
  const [destination, setDestination] = useState('Piqeras, Sarandë');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<TripStatus>('voting');
  const [proposedDate, setProposedDate] = useState('');
  const [proposedTime, setProposedTime] = useState('06:00');
  const [deadlineDate, setDeadlineDate] = useState('');
  const [deadlineTime, setDeadlineTime] = useState('20:00');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!trip || touched) return;
    setTitle(trip.title);
    setDestination(trip.destination);
    setDescription(trip.description ?? '');
    setStatus(trip.status);
    setProposedDate(dates.toDateInput(trip.proposedDeparture));
    setProposedTime(dates.toTimeInput(trip.proposedDeparture));
    setDeadlineDate(trip.votingDeadline ? dates.toDateInput(trip.votingDeadline) : '');
    setDeadlineTime(trip.votingDeadline ? dates.toTimeInput(trip.votingDeadline) : '20:00');
  }, [trip, touched]);

  const proposedDeparture = dates.fromInputs(proposedDate, proposedTime);
  const votingDeadline = deadlineDate
    ? dates.fromInputs(deadlineDate, deadlineTime)
    : null;

  async function onSubmit() {
    if (!uid || !proposedDeparture) return;
    setSaving(true);
    const input: TripInput = {
      title: title.trim() || 'Piqeras',
      destination: destination.trim(),
      description: description.trim() || null,
      proposedDeparture,
      finalDeparture: trip?.finalDeparture ?? null,
      votingDeadline,
      status,
      votingLocked: trip?.votingLocked ?? false,
      // A draft must never be the current trip — the rules reject that write,
      // because member visibility is driven entirely by isCurrent.
      isCurrent: status !== 'draft',
      backgroundImagePath: trip?.backgroundImagePath ?? null,
      backgroundImageUrl: trip?.backgroundImageUrl ?? null,
      backgroundCredit: trip?.backgroundCredit ?? null,
    };
    try {
      if (trip) {
        await updateTrip(trip.id, input, uid);
      } else {
        await createTrip(input, uid);
      }
      setTouched(false);
      onSaved();
    } catch {
      onError();
    } finally {
      setSaving(false);
    }
  }

  async function onPickImage(file: File) {
    if (!trip || !uid) return;
    setImageError(null);

    if (file.size > MAX_IMAGE_BYTES) {
      setImageError(t('imageTooLarge'));
      return;
    }
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      setImageError(t('imageWrongType'));
      return;
    }

    setUploading(true);
    try {
      // Storage rules read the organizer custom claim, which may still be
      // missing from a token minted before the grant landed.
      await refreshClaims();

      const extension = file.type.split('/')[1] ?? 'jpg';
      const path = `trips/${trip.id}/background/cover.${extension}`;
      const objectRef = storageRef(storage, path);
      await uploadBytes(objectRef, file, { contentType: file.type });
      const url = await getDownloadURL(objectRef);
      await setTripBackground(trip.id, path, url, uid);
      onSaved();
    } catch {
      setImageError(t('tripSaveFailed'));
    } finally {
      setUploading(false);
    }
  }

  return (
    <section className="panel stack">
      <p className="section-title">{trip ? t('editTripAction') : t('createTripAction')}</p>

      <div className="field">
        <label className="field__label" htmlFor="trip-title">
          {t('tripTitleLabel')}
        </label>
        <input
          id="trip-title"
          className="input"
          value={title}
          maxLength={60}
          onChange={(e) => {
            setTitle(e.target.value);
            setTouched(true);
          }}
        />
      </div>

      <div className="field">
        <label className="field__label" htmlFor="trip-destination">
          {t('tripDestinationLabel')}
        </label>
        <input
          id="trip-destination"
          className="input"
          value={destination}
          maxLength={60}
          onChange={(e) => {
            setDestination(e.target.value);
            setTouched(true);
          }}
        />
      </div>

      <div className="field">
        <label className="field__label" htmlFor="trip-description">
          {t('tripDescriptionLabel')}
        </label>
        <textarea
          id="trip-description"
          className="input"
          value={description}
          maxLength={500}
          onChange={(e) => {
            setDescription(e.target.value);
            setTouched(true);
          }}
        />
      </div>

      <div className="field">
        <span className="field__label">{t('proposedDepartureLabel')}</span>
        <div className="field__row">
          <input
            className="input"
            type="date"
            aria-label={t('departureDateLabel')}
            value={proposedDate}
            onChange={(e) => {
              setProposedDate(e.target.value);
              setTouched(true);
            }}
          />
          <input
            className="input"
            type="time"
            aria-label={t('departureTimeLabel')}
            value={proposedTime}
            onChange={(e) => {
              setProposedTime(e.target.value);
              setTouched(true);
            }}
          />
        </div>
        {proposedDeparture && <p className="field__hint">{dates.full(proposedDeparture)}</p>}
      </div>

      <div className="field">
        <span className="field__label">{t('votingDeadlineLabel')}</span>
        <div className="field__row">
          <input
            className="input"
            type="date"
            aria-label={t('votingDeadlineLabel')}
            value={deadlineDate}
            onChange={(e) => {
              setDeadlineDate(e.target.value);
              setTouched(true);
            }}
          />
          <input
            className="input"
            type="time"
            aria-label={t('votingDeadlineLabel')}
            value={deadlineTime}
            onChange={(e) => {
              setDeadlineTime(e.target.value);
              setTouched(true);
            }}
          />
        </div>
        {votingDeadline && <p className="field__hint">{dates.full(votingDeadline)}</p>}
      </div>

      <div className="field">
        <label className="field__label" htmlFor="trip-status">
          {t('statusLabel')}
        </label>
        <select
          id="trip-status"
          className="input"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as TripStatus);
            setTouched(true);
          }}
        >
          {TRIP_STATUS_VALUES.map((value) => (
            <option key={value} value={value}>
              {statusLabel(value, t)}
            </option>
          ))}
        </select>
      </div>

      {trip && (
        <div className="field">
          <span className="field__label">{t('backgroundLabel')}</span>
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void onPickImage(file);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            className="btn btn--ghost btn--block"
            onClick={() => fileInput.current?.click()}
            disabled={uploading}
          >
            {uploading ? t('uploadingImage') : t('uploadImageAction')}
          </button>
          {imageError && <p className="field__error">{imageError}</p>}
        </div>
      )}

      <button
        type="button"
        className="btn btn--primary btn--block"
        onClick={onSubmit}
        disabled={saving || busy || !proposedDeparture}
      >
        {saving ? <span className="spinner" aria-hidden="true" /> : t('saveAction')}
      </button>
    </section>
  );
}
