import { useMemo, useRef, useState } from 'react';
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';
import { useT } from '../i18n';
import { useDates } from '../lib/useDates';
import { useAuth } from '../state/auth';
import {
  findDuplicateNames,
  normalizeDisplayName,
  type Attendance,
} from '../lib/domain';
import {
  refreshClaims,
  saveHistoricalTrip,
  setTripBackground,
  type HistoricalAttendeeInput,
} from '../lib/repo';
import { storage } from '../lib/firebase';
import type { Attendee, Member, Trip } from '../lib/types';
import { Banner } from './ui';

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

interface DraftAttendee extends HistoricalAttendeeInput {
  key: string;
}

/**
 * Recording a trip that happened before the app existed, or correcting one.
 *
 * Two things this form is careful about:
 *
 *  - **It never invents a time.** The departure time is opt-in; when it is off,
 *    the trip is saved as `dateOnly` and no clock value is sent at all.
 *  - **Attendees are names, not accounts.** A friend with no Piqeras account is
 *    typed in by hand and stored as a snapshot, so history never depends on a
 *    live profile — and no fake accounts are created to represent anyone.
 */
export function HistoricalTripForm({
  trip,
  existingAttendees,
  members,
  onSaved,
  onCancel,
}: {
  trip: Trip | null;
  existingAttendees: Attendee[];
  members: Member[];
  onSaved: (tripId: string) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const dates = useDates();
  const { uid } = useAuth();
  const editing = trip !== null;

  const [title, setTitle] = useState(trip?.title ?? 'Piqeras');
  const [destination, setDestination] = useState(trip?.destination ?? 'Piqeras, Sarandë');
  const [description, setDescription] = useState(trip?.description ?? '');
  const [memory, setMemory] = useState(trip?.memory ?? '');

  const [dateValue, setDateValue] = useState(
    trip ? dates.toDateInput(trip.proposedDeparture) : '',
  );
  const [timeKnown, setTimeKnown] = useState(trip?.datePrecision === 'dateTime');
  const [timeValue, setTimeValue] = useState(
    trip?.datePrecision === 'dateTime' ? dates.toTimeInput(trip.proposedDeparture) : '06:00',
  );
  const [returnValue, setReturnValue] = useState(
    trip?.returnDate ? dates.toDateInput(trip.returnDate) : '',
  );

  const [attendees, setAttendees] = useState<DraftAttendee[]>(() =>
    existingAttendees.map((a, i) => ({
      key: `existing-${a.id}-${i}`,
      displayName: a.displayName,
      uid: a.uid,
      attendance: a.attendance,
      note: a.note,
      preferredDeparture: a.preferredDeparture,
    })),
  );

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);

  // Held until the trip is saved: a brand-new trip has no id to file the image
  // under until the callable returns one.
  const fileInput = useRef<HTMLInputElement>(null);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(
    trip?.backgroundImageUrl ?? null,
  );

  function onPickCover(file: File) {
    setError(null);
    if (file.size > MAX_IMAGE_BYTES) {
      setError(t('imageTooLarge'));
      return;
    }
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      setError(t('imageWrongType'));
      return;
    }
    setCoverFile(file);
    setCoverPreview(URL.createObjectURL(file));
  }

  /**
   * Uploads the cover once the trip has an id.
   *
   * Storage rules read the organizer custom claim, which can still be missing
   * from a token minted before the role was granted — hence the refresh.
   */
  async function uploadCover(tripId: string) {
    if (!coverFile) return;
    await refreshClaims();
    const extension = coverFile.type.split('/')[1] ?? 'jpg';
    const path = `trips/${tripId}/background/cover.${extension}`;
    const objectRef = storageRef(storage, path);
    await uploadBytes(objectRef, coverFile, { contentType: coverFile.type });
    const url = await getDownloadURL(objectRef);
    await setTripBackground(tripId, path, url, uid!);
  }

  const tripDate = useMemo(
    () =>
      timeKnown
        ? dates.fromInputs(dateValue, timeValue)
        : dates.dateOnlyFromInput(dateValue),
    [dates, dateValue, timeValue, timeKnown],
  );
  const returnDate = useMemo(
    () => dates.dateOnlyFromInput(returnValue),
    [dates, returnValue],
  );

  const duplicates = useMemo(
    () => findDuplicateNames(attendees.map((a) => a.displayName)),
    [attendees],
  );

  const alreadyAdded = useMemo(
    () => new Set(attendees.map((a) => normalizeDisplayName(a.displayName).displayNameLower)),
    [attendees],
  );

  function addMember(member: Member) {
    setAttendees((prev) => [
      ...prev,
      {
        key: `member-${member.uid}-${prev.length}`,
        displayName: member.displayName,
        uid: member.uid,
        attendance: 'yes' as Attendance,
        note: null,
        preferredDeparture: null,
      },
    ]);
  }

  function addManual() {
    setAttendees((prev) => [
      ...prev,
      {
        key: `manual-${prev.length}-${Math.random().toString(36).slice(2, 8)}`,
        displayName: '',
        uid: null,
        attendance: 'yes' as Attendance,
        note: null,
        preferredDeparture: null,
      },
    ]);
  }

  async function onSave() {
    if (!tripDate) {
      setError(t('tripDateRequired'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { tripId } = await saveHistoricalTrip({
        tripId: trip?.id ?? null,
        title: title.trim() || 'Piqeras',
        destination: destination.trim() || 'Piqeras',
        description: description.trim() || null,
        memory: memory.trim() || null,
        tripDate,
        datePrecision: timeKnown ? 'dateTime' : 'dateOnly',
        returnDate,
        // Only meaningful when the time is actually known.
        finalDeparture: timeKnown ? tripDate : null,
        attendees: attendees
          .filter((a) => a.displayName.trim().length > 0)
          .map(({ key: _key, ...rest }) => rest),
      });
      // The cover is uploaded after the save, because a new trip only gets its
      // id from the callable. A failure here must not lose the trip itself.
      try {
        await uploadCover(tripId);
      } catch {
        setError(t('historySaveFailed'));
      }
      onSaved(tripId);
    } catch {
      setError(t('historySaveFailed'));
      setBusy(false);
      setReviewing(false);
    }
  }

  return (
    <section className="panel stack">
      <p className="section-title">
        {editing ? t('editPastTripAction') : t('addPastTripAction')}
      </p>

      <div className="field">
        <label className="field__label" htmlFor="hist-title">{t('tripTitleLabel')}</label>
        <input id="hist-title" className="input" value={title} maxLength={60}
          onChange={(e) => setTitle(e.target.value)} />
      </div>

      <div className="field">
        <label className="field__label" htmlFor="hist-dest">{t('tripDestinationLabel')}</label>
        <input id="hist-dest" className="input" value={destination} maxLength={60}
          onChange={(e) => setDestination(e.target.value)} />
      </div>

      <div className="field">
        <label className="field__label" htmlFor="hist-date">{t('tripDateLabel')}</label>
        <input id="hist-date" type="date" className="input" value={dateValue}
          onChange={(e) => setDateValue(e.target.value)} />
      </div>

      <div className="field">
        <label className="choice" style={{ minHeight: 48 }}>
          <input type="checkbox" checked={timeKnown}
            onChange={(e) => setTimeKnown(e.target.checked)} />
          <span className="choice__text">{t('timeKnownLabel')}</span>
        </label>
        {!timeKnown && <p className="field__hint">{t('timeUnknownHint')}</p>}
      </div>

      {timeKnown && (
        <div className="field">
          <label className="field__label" htmlFor="hist-time">{t('departureTimeLabel')}</label>
          <input id="hist-time" type="time" className="input" value={timeValue}
            onChange={(e) => setTimeValue(e.target.value)} />
        </div>
      )}

      {tripDate && (
        <p className="field__hint">
          {dates.tripDate(tripDate, timeKnown ? 'dateTime' : 'dateOnly')}
        </p>
      )}

      <div className="field">
        <label className="field__label" htmlFor="hist-return">{t('returnDateLabel')}</label>
        <input id="hist-return" type="date" className="input" value={returnValue}
          onChange={(e) => setReturnValue(e.target.value)} />
      </div>

      <div className="field">
        <label className="field__label" htmlFor="hist-desc">{t('tripDescriptionLabel')}</label>
        <textarea id="hist-desc" className="input" value={description} maxLength={500}
          onChange={(e) => setDescription(e.target.value)} />
      </div>

      <div className="field">
        <label className="field__label" htmlFor="hist-memory">{t('memoryLabel')}</label>
        <textarea id="hist-memory" className="input" value={memory} maxLength={1000}
          onChange={(e) => setMemory(e.target.value)} />
      </div>

      <div className="field">
        <span className="field__label">{t('backgroundLabel')}</span>
        {coverPreview && (
          <span
            className="history-card__cover"
            style={{ backgroundImage: `url(${JSON.stringify(coverPreview)})`, borderRadius: 'var(--radius)' }}
            aria-hidden="true"
          />
        )}
        <input
          ref={fileInput}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onPickCover(file);
            e.target.value = '';
          }}
        />
        <button
          type="button"
          className="btn btn--ghost btn--block"
          onClick={() => fileInput.current?.click()}
          disabled={busy}
        >
          {t('uploadImageAction')}
        </button>
      </div>

      {/* ---------------------------------------------------- attendees --- */}
      <div className="field">
        <span className="field__label">{t('attendeesLabel')}</span>

        {attendees.length === 0 && <p className="muted">{t('noAttendeesYet')}</p>}

        <div className="stack stack--tight">
          {attendees.map((a, index) => (
            <div className="attendee-row" key={a.key}>
              <input
                className="input"
                value={a.displayName}
                placeholder={t('attendeeNamePlaceholder')}
                maxLength={60}
                onChange={(e) =>
                  setAttendees((prev) =>
                    prev.map((x, i) =>
                      i === index ? { ...x, displayName: e.target.value } : x,
                    ),
                  )
                }
              />
              <select
                className="input"
                style={{ maxWidth: '9rem' }}
                value={a.attendance}
                onChange={(e) =>
                  setAttendees((prev) =>
                    prev.map((x, i) =>
                      i === index ? { ...x, attendance: e.target.value as Attendance } : x,
                    ),
                  )
                }
              >
                <option value="yes">{t('attendanceYesShort')}</option>
                <option value="maybe">{t('attendanceMaybeShort')}</option>
                <option value="no">{t('attendanceNoShort')}</option>
              </select>
              <button
                type="button"
                className="btn btn--quiet"
                onClick={() =>
                  setAttendees((prev) => prev.filter((_, i) => i !== index))
                }
              >
                {t('removeAttendeeAction')}
              </button>
            </div>
          ))}
        </div>

        {duplicates.map((name) => (
          <Banner tone="warn" key={name}>
            {t('duplicateNameWarning', { name })}
          </Banner>
        ))}

        <button type="button" className="btn btn--ghost btn--block" onClick={addManual}>
          {t('addManualAttendee')}
        </button>

        {members.filter((m) => !alreadyAdded.has(m.displayNameLower)).length > 0 && (
          <div className="stack stack--tight">
            <span className="field__hint">{t('addAttendeeAction')}</span>
            <div className="summary">
              {members
                .filter((m) => !alreadyAdded.has(m.displayNameLower))
                .map((m) => (
                  <button
                    key={m.uid}
                    type="button"
                    className="chip"
                    onClick={() => addMember(m)}
                  >
                    + {m.displayName}
                  </button>
                ))}
            </div>
          </div>
        )}
      </div>

      {error && <Banner tone="error">{error}</Banner>}

      {/* Review before saving, as required — the organizer sees exactly what
          will be written before it is written. */}
      {reviewing ? (
        <div className="stack stack--tight">
          <Banner tone="info">{t('reviewBeforeSaving')}</Banner>
          <p className="body">
            <strong>{title}</strong> — {destination}
            <br />
            {tripDate && dates.tripDate(tripDate, timeKnown ? 'dateTime' : 'dateOnly')}
            <br />
            {t('historyAttendees', {
              count: attendees.filter(
                (a) => a.displayName.trim() && a.attendance !== 'no',
              ).length,
            })}
          </p>
          <div className="btn-row">
            <button type="button" className="btn btn--ghost" onClick={() => setReviewing(false)}
              disabled={busy}>
              {t('backAction')}
            </button>
            <button type="button" className="btn btn--primary" onClick={onSave} disabled={busy}>
              {busy ? <span className="spinner" aria-hidden="true" /> : t('confirmAction')}
            </button>
          </div>
        </div>
      ) : (
        <div className="btn-row">
          <button type="button" className="btn btn--ghost" onClick={onCancel} disabled={busy}>
            {t('cancelAction')}
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => (tripDate ? setReviewing(true) : setError(t('tripDateRequired')))}
            disabled={busy || !tripDate}
          >
            {t('saveAction')}
          </button>
        </div>
      )}
    </section>
  );
}
