// GENERATED FILE — do not edit.
// Source of truth: shared/domain.ts
// Regenerate with: node tools/sync-shared.mjs

/**
 * Pure domain logic. No Firebase imports live in this file, which is what makes
 * it unit-testable with plain `node --test` and no emulator.
 */

export const TIME_ZONE = 'Europe/Tirane';

export type Attendance = 'yes' | 'maybe' | 'no';

export type TripStatus =
  | 'draft'
  | 'voting'
  | 'confirmed'
  | 'completed'
  | 'cancelled'
  | 'archived';

export const ATTENDANCE_VALUES: readonly Attendance[] = ['yes', 'maybe', 'no'];

export const TRIP_STATUS_VALUES: readonly TripStatus[] = [
  'draft',
  'voting',
  'confirmed',
  'completed',
  'cancelled',
  'archived',
];

/**
 * The instant the countdown counts down to.
 *
 * A confirmed official departure always wins. Until the organizer confirms one,
 * the proposal stands in — but callers must also read {@link isDateConfirmed}
 * so the UI can say the date is still being voted on rather than presenting a
 * proposal as final.
 */
export function effectiveDeparture(trip: {
  finalDeparture?: Date | null;
  proposedDeparture: Date;
}): Date {
  return trip.finalDeparture ?? trip.proposedDeparture;
}

export function isDateConfirmed(trip: {
  finalDeparture?: Date | null;
  status: TripStatus;
}): boolean {
  return trip.finalDeparture != null && trip.status === 'confirmed';
}

/**
 * Voting is open only when all three hold: not manually locked, the trip is in
 * a status that accepts responses, and the deadline (if any) has not passed.
 *
 * `now` is injected rather than read from the clock so the deadline behaviour is
 * testable, and so callers on the server always pass the *server* clock.
 */
export function isVotingOpen(
  trip: {
    status: TripStatus;
    votingLocked: boolean;
    votingDeadline?: Date | null;
  },
  now: Date,
): boolean {
  if (trip.votingLocked) return false;
  if (trip.status !== 'voting' && trip.status !== 'confirmed') return false;
  if (trip.votingDeadline && now.getTime() >= trip.votingDeadline.getTime()) return false;
  return true;
}

export interface Countdown {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  /** True once the departure instant has been reached or passed. */
  isPast: boolean;
  totalMs: number;
}

/**
 * Splits the remaining time into whole days/hours/minutes/seconds.
 *
 * Never returns negative components: past departures clamp to all-zero with
 * `isPast` set, which is what lets the UI show "U nisëm për Piqeras!" instead
 * of a negative countdown.
 */
export function computeCountdown(target: Date, now: Date): Countdown {
  const totalMs = target.getTime() - now.getTime();
  if (totalMs <= 0) {
    return { days: 0, hours: 0, minutes: 0, seconds: 0, isPast: true, totalMs };
  }
  const totalSeconds = Math.floor(totalMs / 1000);
  return {
    days: Math.floor(totalSeconds / 86400),
    hours: Math.floor((totalSeconds % 86400) / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
    isPast: false,
    totalMs,
  };
}

/**
 * Month and weekday names, per language.
 *
 * Written out rather than taken from `Intl.DateTimeFormat`'s localised output
 * because the Albanian names are the product's voice, not a locale detail —
 * "Shtator" has to read exactly like this — and because a hand-written table
 * cannot vary with the ICU version shipped by a given browser.
 *
 * Place names are NOT translated: "Piqeras" and "Sarandë" are stored on the
 * trip and rendered verbatim in both languages.
 */
export type DateLocale = 'sq' | 'en' | 'el' | 'ro' | 'it';

export const DATE_LOCALES: readonly DateLocale[] = ['sq', 'en', 'el', 'ro', 'it'];

const MONTHS: Record<DateLocale, readonly string[]> = {
  sq: [
    'Janar', 'Shkurt', 'Mars', 'Prill', 'Maj', 'Qershor',
    'Korrik', 'Gusht', 'Shtator', 'Tetor', 'Nëntor', 'Dhjetor',
  ],
  en: [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ],
  // Greek dates read "24 Σεπτεμβρίου" — the month is genitive after a day
  // number, so the genitive forms are what belong in this table.
  el: [
    'Ιανουαρίου', 'Φεβρουαρίου', 'Μαρτίου', 'Απριλίου', 'Μαΐου', 'Ιουνίου',
    'Ιουλίου', 'Αυγούστου', 'Σεπτεμβρίου', 'Οκτωβρίου', 'Νοεμβρίου', 'Δεκεμβρίου',
  ],
  // Romanian and Italian write month names in lower case mid-sentence, which is
  // where they always appear here ("24 septembrie 2026").
  ro: [
    'ianuarie', 'februarie', 'martie', 'aprilie', 'mai', 'iunie',
    'iulie', 'august', 'septembrie', 'octombrie', 'noiembrie', 'decembrie',
  ],
  it: [
    'gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
    'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre',
  ],
};

/* Weekdays are capitalised even in the languages that lower-case them, because
   the only place they appear is first in `formatFull`. */
const WEEKDAYS: Record<DateLocale, readonly string[]> = {
  sq: ['E diel', 'E hënë', 'E martë', 'E mërkurë', 'E enjte', 'E premte', 'E shtunë'],
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  el: ['Κυριακή', 'Δευτέρα', 'Τρίτη', 'Τετάρτη', 'Πέμπτη', 'Παρασκευή', 'Σάββατο'],
  ro: ['Duminică', 'Luni', 'Marți', 'Miercuri', 'Joi', 'Vineri', 'Sâmbătă'],
  it: ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'],
};

/** Anything unexpected falls back to Albanian, the product's default. */
function lang(locale: string | undefined | null): DateLocale {
  return DATE_LOCALES.includes(locale as DateLocale) ? (locale as DateLocale) : 'sq';
}

/**
 * The clock each language is read on.
 *
 * Every instant in this app is absolute, and Piqeras itself is in Albania — but
 * the members are not. Somebody reading the app in Greek is on Greek time, an
 * hour ahead of Tirana; the same is true in Romanian. Showing them the Albanian
 * wall clock would have them turn up an hour late for a departure they read
 * correctly.
 *
 * English is a language, not a country, so it stays on the trip's own zone.
 * Italy shares Albania's zone, so Italian changes nothing today — it is listed
 * so the table stays a complete answer rather than a list of exceptions.
 */
export const LOCALE_TIME_ZONES: Record<DateLocale, string> = {
  sq: TIME_ZONE,
  en: TIME_ZONE,
  el: 'Europe/Athens',
  ro: 'Europe/Bucharest',
  it: 'Europe/Rome',
};

/** The timezone to render in, for a given interface language. */
export function timeZoneFor(locale: string | undefined | null): string {
  return LOCALE_TIME_ZONES[lang(locale)];
}

/**
 * The instant at which `timeZone`'s clock reads what the trip's own clock reads
 * at `instant`.
 *
 * A 17:00 Tirana departure comes back as the moment Athens says 17:00 — an hour
 * before the departure really happens.
 *
 * THIS IS NOT THE REMAINING TIME, and it is not a bug. The countdown is a gap
 * between two moments, and converting a timezone moves both ends together, so
 * the true gap is identical everywhere. The owner asked for the countdown to read
 * an hour shorter in Greek and Romanian, was shown that this makes it run out
 * before the group actually leaves, and chose it anyway. That is his call.
 *
 * Expressed as "the same clock reading, in their zone" rather than "minus one
 * hour" on purpose: the offset between Tirana and Athens is not always 60
 * minutes during the days when the two zones' daylight-saving switches have not
 * yet lined up, and a hardcoded hour would drift.
 */
export function sameWallClockIn(instant: Date, timeZone: string): Date {
  const p = zonedParts(instant, TIME_ZONE);
  return zonedToInstant(p.year, p.month, p.day, p.hour, p.minute, timeZone);
}

/**
 * Whether a given instant reads as a different wall clock in `timeZone` than it
 * does in the trip's own zone.
 *
 * Compared by rendered time rather than by zone id on purpose: Rome and Tirana
 * are different zones that always agree, and a warning about a difference the
 * reader cannot see is just noise. It is also correct across the fortnight when
 * two zones' daylight-saving switches have not yet lined up.
 */
export function readsAsDifferentTime(instant: Date, timeZone: string): boolean {
  return formatTime(instant, timeZone) !== formatTime(instant, TIME_ZONE);
}

/**
 * Extracts the calendar fields of an instant *as seen in a given timezone*.
 *
 * This is deliberately built on Intl rather than on manual offset arithmetic:
 * Albania switches between CET (UTC+1) and CEST (UTC+2), and the switch dates
 * move every year. Intl reads the real IANA rules, so a departure at 06:00
 * local is 05:00 UTC in winter and 04:00 UTC in summer without any special
 * casing here.
 */
export function zonedParts(
  instant: Date,
  timeZone: string = TIME_ZONE,
): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
} {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    weekday: 'short',
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(instant)) parts[p.type] = p.value;

  const weekdayIndex = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(
    parts.weekday,
  );

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    // Intl renders midnight as "24" in some ICU versions under hour12:false.
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    weekday: weekdayIndex,
  };
}

/** "24 Shtator" / "24 September" */
export function formatDayMonth(
  instant: Date,
  locale: string = 'sq',
  timeZone: string = TIME_ZONE,
): string {
  const p = zonedParts(instant, timeZone);
  return `${p.day} ${MONTHS[lang(locale)][p.month - 1]}`;
}

/** "24 Shtator 2026" / "24 September 2026" */
export function formatDate(
  instant: Date,
  locale: string = 'sq',
  timeZone: string = TIME_ZONE,
): string {
  const p = zonedParts(instant, timeZone);
  return `${p.day} ${MONTHS[lang(locale)][p.month - 1]} ${p.year}`;
}

/**
 * "06:00" — deliberately 24-hour in both languages.
 *
 * The group reads departure times off a clock, and 06:00 is unambiguous
 * everywhere; a 12-hour "6:00 AM" would only add a chance to misread it.
 */
export function formatTime(instant: Date, timeZone: string = TIME_ZONE): string {
  const p = zonedParts(instant, timeZone);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

/** "E enjte, 24 Shtator 2026, 06:00" / "Thursday, 24 September 2026, 06:00" */
export function formatFull(
  instant: Date,
  locale: string = 'sq',
  timeZone: string = TIME_ZONE,
): string {
  const p = zonedParts(instant, timeZone);
  return `${WEEKDAYS[lang(locale)][p.weekday]}, ${formatDate(instant, locale, timeZone)}, ${formatTime(
    instant,
    timeZone,
  )}`;
}

/* Albanian-bound aliases, kept for the server and the admin tools, which have
   no user locale to consult. */
export const formatDayMonthSq = (instant: Date, timeZone: string = TIME_ZONE) =>
  formatDayMonth(instant, 'sq', timeZone);
export const formatDateSq = (instant: Date, timeZone: string = TIME_ZONE) =>
  formatDate(instant, 'sq', timeZone);
export const formatTimeSq = formatTime;
export const formatFullSq = (instant: Date, timeZone: string = TIME_ZONE) =>
  formatFull(instant, 'sq', timeZone);

/**
 * Buckets an instant to the half hour, in the trip's timezone, for the
 * "people who chose a similar time" grouping on the group responses screen.
 */
export function halfHourBucketKey(
  instant: Date,
  timeZone: string = TIME_ZONE,
): string {
  const p = zonedParts(instant, timeZone);
  const half = p.minute < 30 ? '00' : '30';
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}T${String(
    p.hour,
  ).padStart(2, '0')}:${half}`;
}

/** Exact-slot key: identical departure choices group together. */
export function exactSlotKey(instant: Date, timeZone: string = TIME_ZONE): string {
  const p = zonedParts(instant, timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}T${String(
    p.hour,
  ).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

export interface TallyEntry {
  key: string;
  instant: Date;
  count: number;
  uids: string[];
}

/**
 * Counts how many members picked each departure slot, most popular first and
 * earliest first among ties. Members who are not coming are excluded — they
 * have no departure preference to count.
 */
export function tallyDepartureChoices(
  responses: Array<{
    uid: string;
    attendance: Attendance;
    preferredDeparture?: Date | null;
  }>,
  timeZone: string = TIME_ZONE,
): TallyEntry[] {
  const byKey = new Map<string, TallyEntry>();

  for (const r of responses) {
    if (r.attendance === 'no' || !r.preferredDeparture) continue;
    const key = exactSlotKey(r.preferredDeparture, timeZone);
    const existing = byKey.get(key);
    if (existing) {
      existing.count += 1;
      existing.uids.push(r.uid);
    } else {
      byKey.set(key, {
        key,
        instant: r.preferredDeparture,
        count: 1,
        uids: [r.uid],
      });
    }
  }

  return [...byKey.values()].sort(
    (a, b) => b.count - a.count || a.instant.getTime() - b.instant.getTime(),
  );
}

/**
 * Validates a response before it is written. The Security Rules enforce the
 * same invariants server-side; this exists so both clients can show a helpful
 * message instead of a bare PERMISSION_DENIED.
 */
export function validateResponse(input: {
  attendance: string;
  preferredDeparture?: Date | null;
  note?: string | null;
}): { ok: true } | { ok: false; reason: string } {
  if (!ATTENDANCE_VALUES.includes(input.attendance as Attendance)) {
    return { ok: false, reason: 'attendance_invalid' };
  }
  if (input.attendance === 'no') {
    if (input.preferredDeparture) {
      return { ok: false, reason: 'departure_not_allowed' };
    }
  } else if (!input.preferredDeparture) {
    return { ok: false, reason: 'departure_required' };
  }
  if (input.preferredDeparture) {
    const year = input.preferredDeparture.getUTCFullYear();
    if (year < 2020 || year >= 2100) {
      return { ok: false, reason: 'departure_out_of_range' };
    }
  }
  if (input.note != null && input.note.length > 140) {
    return { ok: false, reason: 'note_too_long' };
  }
  return { ok: true };
}

/** Normalises a display name for storage and for the uniqueness claim. */
export function normalizeDisplayName(raw: string): {
  displayName: string;
  displayNameLower: string;
} {
  const displayName = raw.trim().replace(/\s+/g, ' ');
  return { displayName, displayNameLower: displayName.toLowerCase() };
}

export function validateDisplayName(
  raw: string,
): { ok: true; displayName: string; displayNameLower: string } | { ok: false; reason: string } {
  const { displayName, displayNameLower } = normalizeDisplayName(raw);
  if (displayName.length < 2) return { ok: false, reason: 'name_too_short' };
  if (displayName.length > 24) return { ok: false, reason: 'name_too_long' };
  return { ok: true, displayName, displayNameLower };
}

/**
 * The signed offset of a timezone at a given instant, in milliseconds.
 *
 * Derived from Intl rather than a table, so it is correct for whichever side of
 * a DST boundary the instant falls on.
 */
export function zoneOffsetMs(instant: Date, timeZone: string = TIME_ZONE): number {
  const p = zonedParts(instant, timeZone);
  const asUtc = Date.UTC(
    p.year,
    p.month - 1,
    p.day,
    p.hour,
    p.minute,
    instant.getUTCSeconds(),
    instant.getUTCMilliseconds(),
  );
  return asUtc - instant.getTime();
}

/**
 * Converts a wall-clock time *in a timezone* to the UTC instant it names.
 *
 * This is the inverse of {@link zonedParts} and the piece that makes the date
 * and time pickers correct: the member picks "24 September, 06:00" meaning
 * 06:00 in Albania, and that has to become 04:00Z in summer or 05:00Z in
 * winter regardless of where the device itself is.
 *
 * The two-pass offset lookup handles the boundary case where the naive guess
 * lands on the other side of a DST transition from the real answer.
 */
export function zonedToInstant(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string = TIME_ZONE,
): Date {
  const naive = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const firstGuess = new Date(naive - zoneOffsetMs(new Date(naive), timeZone));
  const refined = zoneOffsetMs(firstGuess, timeZone);
  const settled = new Date(naive - refined);
  // A time inside the spring-forward gap does not exist; the second pass lands
  // it just after the jump, which is the conventional resolution.
  return settled;
}

/** "YYYY-MM-DD" for an <input type="date"> showing trip-local time. */
export function toDateInputValue(instant: Date, timeZone: string = TIME_ZONE): string {
  const p = zonedParts(instant, timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** "HH:mm" for an <input type="time"> showing trip-local time. */
export function toTimeInputValue(instant: Date, timeZone: string = TIME_ZONE): string {
  const p = zonedParts(instant, timeZone);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

/**
 * Parses the pair of picker values back into an instant. Returns null when
 * either field is empty or malformed, so callers can keep the save button
 * disabled instead of writing an Invalid Date.
 */
export function fromDateTimeInputs(
  dateValue: string,
  timeValue: string,
  timeZone: string = TIME_ZONE,
): Date | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue);
  const timeMatch = /^(\d{2}):(\d{2})/.exec(timeValue);
  if (!dateMatch || !timeMatch) return null;

  const [, y, mo, d] = dateMatch;
  const [, h, mi] = timeMatch;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  const hour = Number(h);
  const minute = Number(mi);

  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hour > 23 || minute > 59) return null;

  const instant = zonedToInstant(year, month, day, hour, minute, timeZone);
  return Number.isNaN(instant.getTime()) ? null : instant;
}

/**
 * Trip statuses that are still "live" — the current or a future trip.
 *
 * The split matters for two behaviours that must not damage history:
 *  - removing a member deletes their responses on ACTIVE trips only;
 *  - a display-name change propagates to ACTIVE trips only, so a past
 *    response keeps the name the person had at the time.
 */
export const ACTIVE_TRIP_STATUSES: readonly TripStatus[] = ['draft', 'voting', 'confirmed'];

/** Terminal statuses. Responses on these are historical records. */
export const TERMINAL_TRIP_STATUSES: readonly TripStatus[] = [
  'completed',
  'cancelled',
  'archived',
];

export function isTripActive(status: TripStatus): boolean {
  return ACTIVE_TRIP_STATUSES.includes(status);
}

/**
 * Masks an email for the organizer approval screen.
 *
 * Organizers need enough to recognise who is asking to join, without the app
 * ever showing one member's address to another. Computed server-side from the
 * verified token so a client cannot influence it.
 *
 *   ilirdokle43@gmail.com -> il•••••••••@gmail.com
 */
export function maskEmail(email: string | null | undefined): string {
  if (!email) return '';
  const at = email.lastIndexOf('@');
  if (at <= 0) return '•••';
  const local = email.slice(0, at);
  const domain = email.slice(at);
  if (local.length <= 2) return `${local[0] ?? ''}•${domain}`;
  return `${local.slice(0, 2)}${'•'.repeat(Math.min(local.length - 2, 10))}${domain}`;
}

/* ------------------------------------------------------------- history --- */

/**
 * How much of a trip's temporal anchor is real.
 *
 * `proposedDeparture` is the canonical instant for EVERY trip, historical ones
 * included — there is deliberately no second date field. For a trip recorded
 * from memory, only the calendar date is known, and `datePrecision` records
 * that so the UI never invents a departure time.
 */
export type DatePrecision = 'dateOnly' | 'dateTime';

/** Statuses that belong in Historiku. Cancelled is deliberately excluded. */
export const HISTORY_STATUSES: readonly TripStatus[] = ['completed', 'archived'];

export function isHistoryStatus(status: TripStatus): boolean {
  return HISTORY_STATUSES.includes(status);
}

/**
 * The visibility invariant, in one place.
 *
 *     visible === (status !== 'draft')
 *
 * A draft is the organizer's private workspace. Everything else — including a
 * cancelled trip — stays readable by approved members, because it was readable
 * while it was live and retracting that adds a rule branch for no benefit.
 * Cancelled trips are kept out of Historiku by the history *query*, not by
 * visibility, and are always rendered with an explicit cancelled state.
 */
export function isTripVisible(status: TripStatus): boolean {
  return status !== 'draft';
}

/**
 * The instant used to anchor a date-only trip: **12:00 in the trip timezone**.
 *
 * Midnight would be a bug waiting to happen — 00:00 in Tirana is 22:00 UTC on
 * the *previous* day, so any formatter that slipped to UTC would render 18 July
 * as 17 July. Midday is the furthest point from either boundary, and since the
 * time is never displayed for a date-only trip, the choice is invisible.
 */
export function dateOnlyAnchor(
  year: number,
  month: number,
  day: number,
  timeZone: string = TIME_ZONE,
): Date {
  return zonedToInstant(year, month, day, 12, 0, timeZone);
}

/** Parses "YYYY-MM-DD" from a date input into a date-only anchor instant. */
export function dateOnlyFromInput(
  dateValue: string,
  timeZone: string = TIME_ZONE,
): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue);
  if (!m) return null;
  const [, y, mo, d] = m;
  const month = Number(mo);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const instant = dateOnlyAnchor(Number(y), month, day, timeZone);
  return Number.isNaN(instant.getTime()) ? null : instant;
}

/**
 * Renders a trip's anchor according to its precision.
 *
 * A date-only trip shows "18 Korrik 2026" and never "18 Korrik 2026, 00:00" —
 * showing a fabricated midnight is exactly the failure this type prevents.
 */
export function formatTripDate(
  instant: Date,
  precision: DatePrecision,
  locale: string = 'sq',
  timeZone: string = TIME_ZONE,
): string {
  return precision === 'dateOnly'
    ? formatDate(instant, locale, timeZone)
    : formatFull(instant, locale, timeZone);
}

/** Newest first, which is how a history list should read. */
export function sortTripsNewestFirst<T extends { proposedDeparture: Date }>(
  trips: readonly T[],
): T[] {
  return [...trips].sort(
    (a, b) => b.proposedDeparture.getTime() - a.proposedDeparture.getTime(),
  );
}

export type AttendeeSource = 'response' | 'manual';

/**
 * Who counts as having been on the trip.
 *
 * "Not coming" snapshots are kept for the audit trail but are never attendees,
 * so the count on a history card matches the names listed under it.
 */
export function countsAsAttendee(attendance: Attendance): boolean {
  return attendance === 'yes' || attendance === 'maybe';
}

export function countAttendees(
  snapshots: readonly { attendance: Attendance }[],
): number {
  return snapshots.filter((s) => countsAsAttendee(s.attendance)).length;
}

/** Case-insensitive duplicate detection for the manual attendee editor. */
export function findDuplicateNames(names: readonly string[]): string[] {
  const seen = new Map<string, number>();
  for (const raw of names) {
    const key = normalizeDisplayName(raw).displayNameLower;
    if (!key) continue;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  return [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k);
}
