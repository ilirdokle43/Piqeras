import { useEffect, useMemo, useState } from 'react';
import { useT } from '../i18n';
import { useDates } from '../lib/useDates';
import { useAuth } from '../state/auth';
import {
  useChangeNotice,
  useCurrentTrip,
  useNow,
  useOnline,
  useResponses,
  useToast,
} from '../lib/hooks';
import {
  effectiveDeparture,
  isVotingOpen,
  validateResponse,
  type Attendance,
} from '../lib/domain';
import { deleteMyResponse, isPermissionDenied, saveMyResponse } from '../lib/repo';
import { Background } from '../components/Background';
import { AppBar, Banner, Modal, SkeletonBlock, Toast } from '../components/ui';

export function MyResponseScreen({ onBack }: { onBack: () => void }) {
  const t = useT();
  const dates = useDates();
  const { uid, profile } = useAuth();
  const now = useNow(30_000);
  const online = useOnline();
  const [toast, showToast] = useToast();

  const { data: trip, loading } = useCurrentTrip();
  const { data: responses } = useResponses(trip?.id ?? null);
  const mine = useMemo(() => responses.find((r) => r.uid === uid) ?? null, [responses, uid]);

  const [attendance, setAttendance] = useState<Attendance>('yes');
  const [dateValue, setDateValue] = useState('');
  const [timeValue, setTimeValue] = useState('');
  const [note, setNote] = useState('');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);

  const votingOpen = trip ? isVotingOpen(trip, now) : false;
  const deadlinePassed = Boolean(
    trip?.votingDeadline && now.getTime() >= trip.votingDeadline.getTime(),
  );

  // Warn if the organizer moves the date while this form is open — otherwise
  // somebody edits against a date that no longer exists.
  const tripChanged = useChangeNotice(
    trip ? effectiveDeparture(trip).getTime() : undefined,
    !loading,
  );

  /**
   * Seeds the form from the saved response, or from the trip's departure for a
   * first-time responder. Deliberately does not run again once the user has
   * touched a field: a realtime update must never overwrite what they are
   * typing.
   */
  useEffect(() => {
    if (!trip || dirty) return;
    const seed = mine?.preferredDeparture ?? effectiveDeparture(trip);
    setAttendance(mine?.attendance ?? 'yes');
    setDateValue(dates.toDateInput(seed));
    setTimeValue(dates.toTimeInput(seed));
    setNote(mine?.note ?? '');
  }, [trip, mine, dirty]);

  const preferredDeparture = useMemo(
    () => dates.fromInputs(dateValue, timeValue),
    [dates, dateValue, timeValue],
  );

  const needsDeparture = attendance !== 'no';
  const canSave =
    !busy &&
    votingOpen &&
    (!needsDeparture || preferredDeparture !== null) &&
    note.length <= 140;

  async function onSave() {
    if (!trip || !uid || !profile) return;

    const check = validateResponse({
      attendance,
      preferredDeparture: needsDeparture ? preferredDeparture : null,
      note,
    });
    if (!check.ok) {
      setError(check.reason === 'departure_required' ? t('departureRequired') : t('genericError'));
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await saveMyResponse(trip.id, uid, profile.displayName, {
        attendance,
        preferredDeparture: needsDeparture ? preferredDeparture : null,
        note: note.trim() || null,
      });
      setDirty(false);
      showToast(t('savedToast'));
    } catch (err) {
      setError(isPermissionDenied(err) ? t('votingClosedNotice') : t('saveFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function onWithdraw() {
    if (!trip || !uid) return;
    setBusy(true);
    try {
      await deleteMyResponse(trip.id, uid);
      setConfirmWithdraw(false);
      setDirty(false);
      onBack();
    } catch {
      setError(t('genericError'));
      setBusy(false);
    }
  }

  const options: Array<{ value: Attendance; label: string; hint: string }> = [
    { value: 'yes', label: t('attendanceYes'), hint: t('attendanceYesHint') },
    { value: 'maybe', label: t('attendanceMaybe'), hint: t('attendanceMaybeHint') },
    { value: 'no', label: t('attendanceNo'), hint: t('attendanceNoHint') },
  ];

  return (
    <>
      <Background imageUrl={trip?.backgroundImageUrl ?? null} />

      <main className="screen">
        <div className="column">
          <AppBar title={t('myResponseTitle')} onBack={onBack} />

          {!online && <Banner tone="warn" sticky>{t('offline')}</Banner>}

          {loading && !trip && (
            <div className="stack" aria-busy="true">
              <SkeletonBlock height={72} />
              <SkeletonBlock height={72} />
              <SkeletonBlock height={72} />
            </div>
          )}

          {!loading && !trip && <Banner tone="info">{t('noTripBody')}</Banner>}

          {trip && (
            <div className="stack">
              {!votingOpen && (
                <Banner tone="warn">
                  {deadlinePassed ? t('deadlinePassedNotice') : t('votingClosedNotice')}
                </Banner>
              )}

              {tripChanged && <Banner tone="info">{t('tripChangedNotice')}</Banner>}

              <section className="panel stack">
                <p className="section-title">{t('attendanceQuestion')}</p>
                <div className="choices" role="radiogroup" aria-label={t('attendanceQuestion')}>
                  {options.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={attendance === option.value}
                      className={`choice choice--${option.value}`}
                      onClick={() => {
                        setAttendance(option.value);
                        setDirty(true);
                        setError(null);
                      }}
                      disabled={!votingOpen}
                    >
                      <span className="choice__mark" aria-hidden="true" />
                      <span>
                        <span className="choice__text">{option.label}</span>
                        <br />
                        <span className="choice__sub">{option.hint}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </section>

              {needsDeparture && (
                <section className="panel stack">
                  <p className="section-title">{t('departureQuestion')}</p>
                  <div className="field__row">
                    <div className="field">
                      <label className="field__label" htmlFor="departure-date">
                        {t('departureDateLabel')}
                      </label>
                      <input
                        id="departure-date"
                        type="date"
                        className="input"
                        value={dateValue}
                        onChange={(e) => {
                          setDateValue(e.target.value);
                          setDirty(true);
                          setError(null);
                        }}
                        disabled={!votingOpen}
                      />
                    </div>
                    <div className="field">
                      <label className="field__label" htmlFor="departure-time">
                        {t('departureTimeLabel')}
                      </label>
                      <input
                        id="departure-time"
                        type="time"
                        className="input"
                        value={timeValue}
                        onChange={(e) => {
                          setTimeValue(e.target.value);
                          setDirty(true);
                          setError(null);
                        }}
                        disabled={!votingOpen}
                      />
                    </div>
                  </div>
                  {preferredDeparture && (
                    <p className="field__hint">{dates.full(preferredDeparture)}</p>
                  )}
                  {/* The picker reads and writes in this reader's own zone, so
                      say which one before they commit a departure time. */}
                  {preferredDeparture && dates.differsFromTripZone(preferredDeparture) && (
                    <p className="field__hint">{t('timeZoneNotice')}</p>
                  )}
                </section>
              )}

              <section className="panel stack">
                <div className="field">
                  <label className="field__label" htmlFor="note">
                    {t('noteLabel')}
                  </label>
                  <textarea
                    id="note"
                    className="input"
                    value={note}
                    maxLength={140}
                    placeholder={t('notePlaceholder')}
                    onChange={(e) => {
                      setNote(e.target.value);
                      setDirty(true);
                    }}
                    disabled={!votingOpen}
                  />
                  <p className="field__hint">{t('noteHint', { count: note.length })}</p>
                </div>
              </section>

              {error && <Banner tone="error">{error}</Banner>}

              <div className="stack stack--tight">
                <button
                  type="button"
                  className="btn btn--primary btn--block"
                  onClick={onSave}
                  disabled={!canSave}
                >
                  {busy ? <span className="spinner" aria-hidden="true" /> : t('saveAction')}
                </button>

                {mine?.updatedAt && (
                  <p className="muted" style={{ textAlign: 'center' }}>
                    {t('savedAt', { date: dates.full(mine.updatedAt) })}
                  </p>
                )}

                {mine && votingOpen && (
                  <button
                    type="button"
                    className="btn btn--quiet btn--block"
                    onClick={() => setConfirmWithdraw(true)}
                  >
                    {t('withdrawAction')}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </main>

      {confirmWithdraw && (
        <Modal
          title={t('withdrawConfirmTitle')}
          body={t('withdrawConfirmBody')}
          confirmLabel={t('withdrawAction')}
          tone="danger"
          busy={busy}
          onConfirm={onWithdraw}
          onCancel={() => setConfirmWithdraw(false)}
        />
      )}

      <Toast message={toast} />
    </>
  );
}
