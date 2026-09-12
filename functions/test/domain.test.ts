/**
 * Pure domain tests — no emulator, no Firebase, no network.
 *
 *   npm --prefix functions test
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeCountdown,
  effectiveDeparture,
  isDateConfirmed,
  isVotingOpen,
  formatDateSq,
  formatDayMonthSq,
  formatTimeSq,
  formatFullSq,
  zonedParts,
  exactSlotKey,
  halfHourBucketKey,
  tallyDepartureChoices,
  validateResponse,
  validateDisplayName,
  normalizeDisplayName,
  zonedToInstant,
  zoneOffsetMs,
  toDateInputValue,
  toTimeInputValue,
  fromDateTimeInputs,
  isTripActive,
  maskEmail,
  ACTIVE_TRIP_STATUSES,
  TERMINAL_TRIP_STATUSES,
  TRIP_STATUS_VALUES,
  dateOnlyAnchor,
  dateOnlyFromInput,
  formatTripDate,
  isTripVisible,
  isHistoryStatus,
  HISTORY_STATUSES,
  sortTripsNewestFirst,
  countsAsAttendee,
  countAttendees,
  findDuplicateNames,
  DATE_LOCALES,
  LOCALE_TIME_ZONES,
  TIME_ZONE,
  sameWallClockIn,
  formatTime,
  readsAsDifferentTime,
  timeZoneFor,
  formatDate,
  formatDayMonth,
  formatFull,
} from '../src/domain';

/** 24 September 2026, 06:00 in Tirana. September is CEST (UTC+2). */
const DEPARTURE = new Date('2026-09-24T04:00:00.000Z');

describe('computeCountdown', () => {
  test('splits a duration into days, hours, minutes and seconds', () => {
    const now = new Date(DEPARTURE.getTime() - (((30 * 24 + 9) * 60 + 31) * 60 + 56) * 1000);
    const c = computeCountdown(DEPARTURE, now);
    assert.deepEqual(
      { days: c.days, hours: c.hours, minutes: c.minutes, seconds: c.seconds },
      { days: 30, hours: 9, minutes: 31, seconds: 56 },
    );
    assert.equal(c.isPast, false);
  });

  test('counts a plain one-second remainder', () => {
    const c = computeCountdown(DEPARTURE, new Date(DEPARTURE.getTime() - 1000));
    assert.deepEqual(
      { d: c.days, h: c.hours, m: c.minutes, s: c.seconds },
      { d: 0, h: 0, m: 0, s: 1 },
    );
  });

  test('the exact departure instant is already past', () => {
    const c = computeCountdown(DEPARTURE, DEPARTURE);
    assert.equal(c.isPast, true);
    assert.deepEqual(
      { d: c.days, h: c.hours, m: c.minutes, s: c.seconds },
      { d: 0, h: 0, m: 0, s: 0 },
    );
  });

  test('never returns negative components after departure', () => {
    const c = computeCountdown(DEPARTURE, new Date(DEPARTURE.getTime() + 5 * 86400_000));
    assert.equal(c.isPast, true);
    assert.ok(c.days === 0 && c.hours === 0 && c.minutes === 0 && c.seconds === 0);
    assert.ok(c.totalMs < 0, 'totalMs stays signed so callers can measure how long ago');
  });

  test('truncates rather than rounds, so the last second is shown in full', () => {
    const c = computeCountdown(DEPARTURE, new Date(DEPARTURE.getTime() - 1999));
    assert.equal(c.seconds, 1);
  });

  test('handles a year-long gap', () => {
    const now = new Date('2025-09-24T04:00:00.000Z');
    const c = computeCountdown(DEPARTURE, now);
    assert.equal(c.days, 365);
  });

  test('spans a DST boundary without gaining or losing an hour of real time', () => {
    // Real elapsed time is unaffected by the wall-clock jump: the countdown is
    // computed on instants, never on local calendar arithmetic.
    const target = new Date('2026-03-30T00:00:00.000Z');
    const now = new Date('2026-03-28T00:00:00.000Z');
    const c = computeCountdown(target, now);
    assert.deepEqual({ d: c.days, h: c.hours }, { d: 2, h: 0 });
  });
});

describe('Europe/Tirane conversion', () => {
  test('renders a summer departure at its local wall-clock time', () => {
    assert.equal(formatTimeSq(DEPARTURE), '06:00');
    assert.equal(formatDayMonthSq(DEPARTURE), '24 Shtator');
    assert.equal(formatDateSq(DEPARTURE), '24 Shtator 2026');
  });

  test('renders the weekday in Albanian', () => {
    // 24 September 2026 is a Thursday.
    assert.equal(formatFullSq(DEPARTURE), 'E enjte, 24 Shtator 2026, 06:00');
  });

  test('applies CET (+1) in winter', () => {
    // 15 January 2026, 05:00 UTC is 06:00 in Tirana.
    assert.equal(formatTimeSq(new Date('2026-01-15T05:00:00.000Z')), '06:00');
  });

  test('applies CEST (+2) in summer', () => {
    // 15 July 2026, 04:00 UTC is 06:00 in Tirana.
    assert.equal(formatTimeSq(new Date('2026-07-15T04:00:00.000Z')), '06:00');
  });

  test('the spring-forward hour does not exist locally', () => {
    // DST starts at 01:00 UTC on 29 March 2026: 01:59 CET becomes 03:00 CEST.
    assert.equal(formatTimeSq(new Date('2026-03-29T00:30:00.000Z')), '01:30');
    assert.equal(formatTimeSq(new Date('2026-03-29T01:30:00.000Z')), '03:30');
  });

  test('the autumn ambiguous hour maps two instants to the same wall clock', () => {
    // DST ends at 01:00 UTC on 25 October 2026.
    assert.equal(formatTimeSq(new Date('2026-10-25T00:30:00.000Z')), '02:30');
    assert.equal(formatTimeSq(new Date('2026-10-25T01:30:00.000Z')), '02:30');
  });

  test('a departure just before local midnight keeps its own calendar date', () => {
    // 23:30 local on 24 September is 21:30 UTC the same day.
    const d = new Date('2026-09-24T21:30:00.000Z');
    assert.equal(formatDateSq(d), '24 Shtator 2026');
    assert.equal(formatTimeSq(d), '23:30');
  });

  test('a departure just after local midnight rolls to the next calendar date', () => {
    // 00:30 local on 25 September is 22:30 UTC on the 24th.
    const d = new Date('2026-09-24T22:30:00.000Z');
    assert.equal(formatDateSq(d), '25 Shtator 2026');
    assert.equal(formatTimeSq(d), '00:30');
  });

  test('local midnight renders as 00:00, not 24:00', () => {
    const d = new Date('2026-09-24T22:00:00.000Z');
    assert.equal(formatTimeSq(d), '00:00');
  });

  test('a viewer in another timezone still sees Tirana time', () => {
    // The formatter is explicit about the zone, so the host clock is irrelevant.
    assert.equal(formatTimeSq(DEPARTURE, 'Europe/Tirane'), '06:00');
    assert.equal(formatTimeSq(DEPARTURE, 'America/New_York'), '00:00');
    assert.equal(zonedParts(DEPARTURE, 'Asia/Tokyo').hour, 13);
  });
});

describe('effective departure', () => {
  test('falls back to the proposal while voting', () => {
    const trip = { proposedDeparture: DEPARTURE, finalDeparture: null, status: 'voting' as const };
    assert.equal(effectiveDeparture(trip).getTime(), DEPARTURE.getTime());
    assert.equal(isDateConfirmed(trip), false);
  });

  test('prefers the confirmed official departure', () => {
    const final = new Date('2026-09-25T04:00:00.000Z');
    const trip = {
      proposedDeparture: DEPARTURE,
      finalDeparture: final,
      status: 'confirmed' as const,
    };
    assert.equal(effectiveDeparture(trip).getTime(), final.getTime());
    assert.equal(isDateConfirmed(trip), true);
  });

  test('a final date on a trip that is not confirmed is still not official', () => {
    assert.equal(
      isDateConfirmed({ finalDeparture: DEPARTURE, status: 'voting' }),
      false,
    );
  });
});

describe('voting window', () => {
  const base = { status: 'voting' as const, votingLocked: false, votingDeadline: null };
  const now = new Date('2026-09-01T10:00:00.000Z');

  test('open with no deadline', () => {
    assert.equal(isVotingOpen(base, now), true);
  });

  test('open before the deadline', () => {
    assert.equal(
      isVotingOpen({ ...base, votingDeadline: new Date('2026-09-02T00:00:00Z') }, now),
      true,
    );
  });

  test('closed after the deadline', () => {
    assert.equal(
      isVotingOpen({ ...base, votingDeadline: new Date('2026-08-31T00:00:00Z') }, now),
      false,
    );
  });

  test('closed exactly at the deadline', () => {
    assert.equal(isVotingOpen({ ...base, votingDeadline: now }, now), false);
  });

  test('closed when manually locked', () => {
    assert.equal(isVotingOpen({ ...base, votingLocked: true }, now), false);
  });

  test('still open on a confirmed trip', () => {
    assert.equal(isVotingOpen({ ...base, status: 'confirmed' }, now), true);
  });

  test('closed on draft, cancelled, completed and archived trips', () => {
    for (const status of ['draft', 'cancelled', 'completed', 'archived'] as const) {
      assert.equal(isVotingOpen({ ...base, status }, now), false, status);
    }
  });
});

describe('departure choice tally', () => {
  const at = (iso: string) => new Date(iso);

  test('groups identical choices and ranks by popularity', () => {
    const tally = tallyDepartureChoices([
      { uid: 'a', attendance: 'yes', preferredDeparture: at('2026-09-24T04:00:00Z') },
      { uid: 'b', attendance: 'yes', preferredDeparture: at('2026-09-24T04:00:00Z') },
      { uid: 'c', attendance: 'maybe', preferredDeparture: at('2026-09-24T06:00:00Z') },
    ]);
    assert.equal(tally.length, 2);
    assert.equal(tally[0].count, 2);
    assert.deepEqual(tally[0].uids, ['a', 'b']);
    assert.equal(tally[1].count, 1);
  });

  test('breaks ties by the earlier departure', () => {
    const tally = tallyDepartureChoices([
      { uid: 'a', attendance: 'yes', preferredDeparture: at('2026-09-24T08:00:00Z') },
      { uid: 'b', attendance: 'yes', preferredDeparture: at('2026-09-24T04:00:00Z') },
    ]);
    assert.equal(tally[0].uids[0], 'b');
  });

  test('ignores members who are not coming', () => {
    const tally = tallyDepartureChoices([
      { uid: 'a', attendance: 'no', preferredDeparture: null },
      { uid: 'b', attendance: 'yes', preferredDeparture: at('2026-09-24T04:00:00Z') },
    ]);
    assert.equal(tally.length, 1);
    assert.deepEqual(tally[0].uids, ['b']);
  });

  test('counts "maybe" votes towards a slot', () => {
    const tally = tallyDepartureChoices([
      { uid: 'a', attendance: 'maybe', preferredDeparture: at('2026-09-24T04:00:00Z') },
    ]);
    assert.equal(tally[0].count, 1);
  });

  test('an empty response set tallies to nothing', () => {
    assert.deepEqual(tallyDepartureChoices([]), []);
  });
});

describe('slot keys', () => {
  test('the exact key separates 06:00 from 06:30', () => {
    assert.notEqual(
      exactSlotKey(new Date('2026-09-24T04:00:00Z')),
      exactSlotKey(new Date('2026-09-24T04:30:00Z')),
    );
  });

  test('the half-hour bucket groups 06:00 with 06:20', () => {
    assert.equal(
      halfHourBucketKey(new Date('2026-09-24T04:00:00Z')),
      halfHourBucketKey(new Date('2026-09-24T04:20:00Z')),
    );
  });

  test('the half-hour bucket separates 06:20 from 06:40', () => {
    assert.notEqual(
      halfHourBucketKey(new Date('2026-09-24T04:20:00Z')),
      halfHourBucketKey(new Date('2026-09-24T04:40:00Z')),
    );
  });

  test('keys are computed in local time, so they do not split across UTC midnight', () => {
    // 01:00 and 01:30 local on 25 September; both are 24 September in UTC.
    const a = exactSlotKey(new Date('2026-09-24T23:00:00Z'));
    assert.ok(a.startsWith('2026-09-25T01:00'), a);
  });
});

describe('response validation', () => {
  test('accepts a complete "yes"', () => {
    assert.deepEqual(
      validateResponse({ attendance: 'yes', preferredDeparture: DEPARTURE }),
      { ok: true },
    );
  });

  test('rejects "yes" without a departure', () => {
    assert.deepEqual(validateResponse({ attendance: 'yes' }), {
      ok: false,
      reason: 'departure_required',
    });
  });

  test('rejects "maybe" without a departure', () => {
    assert.deepEqual(validateResponse({ attendance: 'maybe' }), {
      ok: false,
      reason: 'departure_required',
    });
  });

  test('accepts "no" with no departure', () => {
    assert.deepEqual(validateResponse({ attendance: 'no' }), { ok: true });
  });

  test('rejects "no" carrying a departure', () => {
    assert.deepEqual(
      validateResponse({ attendance: 'no', preferredDeparture: DEPARTURE }),
      { ok: false, reason: 'departure_not_allowed' },
    );
  });

  test('rejects an unknown attendance value', () => {
    assert.equal(validateResponse({ attendance: 'po' }).ok, false);
  });

  test('rejects an absurd departure year', () => {
    assert.deepEqual(
      validateResponse({
        attendance: 'yes',
        preferredDeparture: new Date('1999-01-01T00:00:00Z'),
      }),
      { ok: false, reason: 'departure_out_of_range' },
    );
  });

  test('rejects a note over 140 characters', () => {
    assert.deepEqual(
      validateResponse({
        attendance: 'yes',
        preferredDeparture: DEPARTURE,
        note: 'x'.repeat(141),
      }),
      { ok: false, reason: 'note_too_long' },
    );
  });

  test('accepts a 140-character note', () => {
    assert.equal(
      validateResponse({
        attendance: 'yes',
        preferredDeparture: DEPARTURE,
        note: 'x'.repeat(140),
      }).ok,
      true,
    );
  });
});

describe('display names', () => {
  test('trims and collapses whitespace', () => {
    assert.deepEqual(normalizeDisplayName('  Ana   Maria  '), {
      displayName: 'Ana Maria',
      displayNameLower: 'ana maria',
    });
  });

  test('lowercases Albanian characters correctly', () => {
    assert.equal(normalizeDisplayName('Ëngjëll').displayNameLower, 'ëngjëll');
    assert.equal(normalizeDisplayName('ÇAJUPI').displayNameLower, 'çajupi');
  });

  test('rejects a single character', () => {
    assert.deepEqual(validateDisplayName('A'), { ok: false, reason: 'name_too_short' });
  });

  test('rejects whitespace-only input', () => {
    assert.deepEqual(validateDisplayName('   '), { ok: false, reason: 'name_too_short' });
  });

  test('rejects more than 24 characters', () => {
    assert.deepEqual(validateDisplayName('a'.repeat(25)), {
      ok: false,
      reason: 'name_too_long',
    });
  });

  test('accepts a normal name', () => {
    assert.deepEqual(validateDisplayName(' Besi '), {
      ok: true,
      displayName: 'Besi',
      displayNameLower: 'besi',
    });
  });

  test('two names differing only in case collide on the claim key', () => {
    assert.equal(
      validateDisplayName('BESI').ok && normalizeDisplayName('BESI').displayNameLower,
      normalizeDisplayName('besi').displayNameLower,
    );
  });
});

describe('wall-clock to instant conversion', () => {
  test('06:00 Tirana in September is 04:00 UTC (CEST)', () => {
    const d = zonedToInstant(2026, 9, 24, 6, 0);
    assert.equal(d.toISOString(), '2026-09-24T04:00:00.000Z');
  });

  test('06:00 Tirana in January is 05:00 UTC (CET)', () => {
    const d = zonedToInstant(2026, 1, 15, 6, 0);
    assert.equal(d.toISOString(), '2026-01-15T05:00:00.000Z');
  });

  test('round-trips through the picker representation', () => {
    const original = new Date('2026-09-24T04:00:00.000Z');
    const back = fromDateTimeInputs(
      toDateInputValue(original),
      toTimeInputValue(original),
    );
    assert.equal(back?.toISOString(), original.toISOString());
  });

  test('round-trips across the winter boundary too', () => {
    const original = new Date('2026-12-31T22:30:00.000Z');
    const back = fromDateTimeInputs(
      toDateInputValue(original),
      toTimeInputValue(original),
    );
    assert.equal(back?.toISOString(), original.toISOString());
  });

  test('resolves a time inside the spring-forward gap', () => {
    // 02:30 on 29 March 2026 does not exist in Tirana; it must still produce a
    // real instant rather than NaN or a silently wrong hour.
    const d = zonedToInstant(2026, 3, 29, 2, 30);
    assert.ok(!Number.isNaN(d.getTime()));
    assert.equal(d.toISOString(), '2026-03-29T01:30:00.000Z');
    assert.equal(formatTimeSq(d), '03:30');
  });

  test('resolves a time inside the autumn ambiguous hour', () => {
    const d = zonedToInstant(2026, 10, 25, 2, 30);
    assert.equal(formatTimeSq(d), '02:30');
  });

  test('the offset is +2h in summer and +1h in winter', () => {
    assert.equal(zoneOffsetMs(new Date('2026-07-01T00:00:00Z')), 2 * 3600_000);
    assert.equal(zoneOffsetMs(new Date('2026-01-01T00:00:00Z')), 1 * 3600_000);
  });

  test('rejects empty or malformed picker values', () => {
    assert.equal(fromDateTimeInputs('', '06:00'), null);
    assert.equal(fromDateTimeInputs('2026-09-24', ''), null);
    assert.equal(fromDateTimeInputs('24/09/2026', '06:00'), null);
    assert.equal(fromDateTimeInputs('2026-13-01', '06:00'), null);
    assert.equal(fromDateTimeInputs('2026-09-24', '25:00'), null);
  });

  test('accepts a time input that includes seconds', () => {
    assert.equal(
      fromDateTimeInputs('2026-09-24', '06:00:00')?.toISOString(),
      '2026-09-24T04:00:00.000Z',
    );
  });
});

describe('trip lifecycle classification', () => {
  test('draft, voting and confirmed trips are active', () => {
    for (const s of ['draft', 'voting', 'confirmed'] as const) {
      assert.equal(isTripActive(s), true, s);
    }
  });

  test('completed, cancelled and archived trips are historical', () => {
    for (const s of ['completed', 'cancelled', 'archived'] as const) {
      assert.equal(isTripActive(s), false, s);
    }
  });

  test('every status is classified exactly once', () => {
    assert.equal(
      ACTIVE_TRIP_STATUSES.length + TERMINAL_TRIP_STATUSES.length,
      TRIP_STATUS_VALUES.length,
    );
    for (const s of TRIP_STATUS_VALUES) {
      const inActive = ACTIVE_TRIP_STATUSES.includes(s);
      const inTerminal = TERMINAL_TRIP_STATUSES.includes(s);
      assert.equal(inActive !== inTerminal, true, `${s} must be in exactly one list`);
    }
  });
});

describe('email masking for the approval screen', () => {
  test('keeps the first two characters and the domain', () => {
    assert.equal(maskEmail('ilirdokle43@gmail.com'), 'il•••••••••@gmail.com');
  });

  test('never reveals the middle of the local part', () => {
    const masked = maskEmail('someverylongaddress@gmail.com');
    assert.equal(masked.includes('verylong'), false);
    assert.equal(masked.endsWith('@gmail.com'), true);
  });

  test('caps the number of dots so length is not leaked', () => {
    const short = maskEmail('abcdefg@x.com');
    const long = maskEmail('abcdefghijklmnopqrstuvwxyz@x.com');
    assert.equal(long.split('•').length - 1 <= 10, true);
    assert.ok(short.startsWith('ab'));
  });

  test('handles a two-character local part without exposing it', () => {
    assert.equal(maskEmail('ab@x.com'), 'a•@x.com');
  });

  test('returns an empty string for a missing address', () => {
    assert.equal(maskEmail(null), '');
    assert.equal(maskEmail(undefined), '');
    assert.equal(maskEmail(''), '');
  });

  test('does not crash on a malformed address', () => {
    assert.equal(maskEmail('not-an-email'), '•••');
  });
});

describe('date-only trips never show a fabricated time', () => {
  test('the anchor is midday in Tirana, not midnight', () => {
    const d = dateOnlyAnchor(2026, 7, 18);
    // 12:00 Tirana in July (CEST, UTC+2) is 10:00Z.
    assert.equal(d.toISOString(), '2026-07-18T10:00:00.000Z');
    assert.equal(formatTimeSq(d), '12:00');
  });

  test('the anchor keeps the intended calendar date, unlike midnight', () => {
    const midday = dateOnlyAnchor(2026, 7, 18);
    assert.equal(formatDateSq(midday), '18 Korrik 2026');

    // Midnight local is 22:00Z the PREVIOUS day — one slip to UTC and the
    // trip displays as the 17th. This is why midday is used.
    const midnight = zonedToInstant(2026, 7, 18, 0, 0);
    assert.equal(midnight.toISOString(), '2026-07-17T22:00:00.000Z');
    assert.equal(midnight.getUTCDate(), 17);
    assert.equal(midday.getUTCDate(), 18);
  });

  test('a winter date-only anchor also lands on its own day', () => {
    const d = dateOnlyAnchor(2026, 1, 15);
    assert.equal(d.toISOString(), '2026-01-15T11:00:00.000Z'); // CET, UTC+1
    assert.equal(formatDateSq(d), '15 Janar 2026');
  });

  test('formatTripDate renders a date-only trip without any time', () => {
    const d = dateOnlyAnchor(2026, 7, 18);
    const rendered = formatTripDate(d, 'dateOnly');
    assert.equal(rendered, '18 Korrik 2026');
    assert.equal(/\d{2}:\d{2}/.test(rendered), false, 'must contain no clock time');
    assert.equal(rendered.includes('00:00'), false);
  });

  test('formatTripDate renders a full date/time trip with its time', () => {
    const d = new Date('2026-09-24T04:00:00.000Z');
    assert.equal(formatTripDate(d, 'dateTime'), 'E enjte, 24 Shtator 2026, 06:00');
  });

  test('parses a date input into a date-only anchor', () => {
    assert.equal(dateOnlyFromInput('2026-07-18')?.toISOString(), '2026-07-18T10:00:00.000Z');
    assert.equal(dateOnlyFromInput(''), null);
    assert.equal(dateOnlyFromInput('18/07/2026'), null);
    assert.equal(dateOnlyFromInput('2026-13-01'), null);
  });
});

describe('the visibility invariant', () => {
  test('only a draft is invisible', () => {
    assert.equal(isTripVisible('draft'), false);
    for (const s of ['voting', 'confirmed', 'completed', 'cancelled', 'archived'] as const) {
      assert.equal(isTripVisible(s), true, s);
    }
  });

  test('visible === (status !== draft) for every status', () => {
    for (const s of TRIP_STATUS_VALUES) {
      assert.equal(isTripVisible(s), s !== 'draft', s);
    }
  });

  test('a cancelled trip is visible but is not history', () => {
    assert.equal(isTripVisible('cancelled'), true);
    assert.equal(isHistoryStatus('cancelled'), false);
  });
});

describe('what belongs in Historiku', () => {
  test('only completed and archived trips', () => {
    assert.deepEqual([...HISTORY_STATUSES], ['completed', 'archived']);
    assert.equal(isHistoryStatus('completed'), true);
    assert.equal(isHistoryStatus('archived'), true);
  });

  test('live, draft and cancelled trips are excluded', () => {
    for (const s of ['draft', 'voting', 'confirmed', 'cancelled'] as const) {
      assert.equal(isHistoryStatus(s), false, s);
    }
  });

  test('sorts newest first', () => {
    const trips = [
      { id: 'a', proposedDeparture: new Date('2025-08-10T10:00:00Z') },
      { id: 'c', proposedDeparture: new Date('2026-09-24T04:00:00Z') },
      { id: 'b', proposedDeparture: new Date('2026-07-18T10:00:00Z') },
    ];
    assert.deepEqual(sortTripsNewestFirst(trips).map((t) => t.id), ['c', 'b', 'a']);
  });

  test('sorting does not mutate the input', () => {
    const trips = [
      { proposedDeparture: new Date('2025-01-01T00:00:00Z') },
      { proposedDeparture: new Date('2026-01-01T00:00:00Z') },
    ];
    const copy = [...trips];
    sortTripsNewestFirst(trips);
    assert.deepEqual(trips, copy);
  });

  test('handles several trips in the same year', () => {
    const trips = [
      { id: 'jul', proposedDeparture: new Date('2026-07-18T10:00:00Z') },
      { id: 'sep', proposedDeparture: new Date('2026-09-24T04:00:00Z') },
      { id: 'may', proposedDeparture: new Date('2026-05-02T10:00:00Z') },
    ];
    assert.deepEqual(sortTripsNewestFirst(trips).map((t) => t.id), ['sep', 'jul', 'may']);
  });
});

describe('attendee counting', () => {
  test('yes and maybe count, no does not', () => {
    assert.equal(countsAsAttendee('yes'), true);
    assert.equal(countsAsAttendee('maybe'), true);
    assert.equal(countsAsAttendee('no'), false);
  });

  test('counts a mixed snapshot list', () => {
    assert.equal(
      countAttendees([
        { attendance: 'yes' },
        { attendance: 'yes' },
        { attendance: 'maybe' },
        { attendance: 'no' },
      ]),
      3,
    );
  });

  test('an empty attendee list counts zero', () => {
    assert.equal(countAttendees([]), 0);
  });

  test('a list of only "no" counts zero', () => {
    assert.equal(countAttendees([{ attendance: 'no' }, { attendance: 'no' }]), 0);
  });
});

describe('duplicate historical names', () => {
  test('detects a case-insensitive duplicate', () => {
    assert.deepEqual(findDuplicateNames(['Ilir', 'Ana', 'ilir']), ['ilir']);
  });

  test('ignores whitespace differences', () => {
    assert.deepEqual(findDuplicateNames(['Ana  Maria', 'ana maria']), ['ana maria']);
  });

  test('returns nothing when all names are distinct', () => {
    assert.deepEqual(findDuplicateNames(['Ilir', 'Ana', 'Besi']), []);
  });

  test('ignores empty entries', () => {
    assert.deepEqual(findDuplicateNames(['', '  ', 'Ana']), []);
  });
});

describe('the clock follows the interface language', () => {
  // 06:00 in Tirana, which is 07:00 in Athens and Bucharest.
  const SUMMER = new Date('2026-09-24T04:00:00.000Z');
  // Mid-January: Tirana on CET, Athens on EET. Still exactly one hour apart.
  const WINTER = new Date('2026-01-15T05:00:00.000Z');

  test('each language maps to the clock its readers are on', () => {
    assert.equal(timeZoneFor('sq'), 'Europe/Tirane');
    assert.equal(timeZoneFor('el'), 'Europe/Athens');
    assert.equal(timeZoneFor('ro'), 'Europe/Bucharest');
    assert.equal(timeZoneFor('it'), 'Europe/Rome');
    // English is a language, not a country: it stays on the trip's own clock.
    assert.equal(timeZoneFor('en'), 'Europe/Tirane');
    assert.equal(timeZoneFor('de'), 'Europe/Tirane');
    assert.equal(timeZoneFor(undefined), 'Europe/Tirane');
  });

  test('a 06:00 Tirana departure reads as 07:00 in Greek and Romanian', () => {
    for (const instant of [SUMMER, WINTER]) {
      assert.equal(formatTime(instant, timeZoneFor('sq')), '06:00');
      assert.equal(formatTime(instant, timeZoneFor('en')), '06:00');
      assert.equal(formatTime(instant, timeZoneFor('it')), '06:00');
      assert.equal(formatTime(instant, timeZoneFor('el')), '07:00');
      assert.equal(formatTime(instant, timeZoneFor('ro')), '07:00');
    }
  });

  test('the full date carries the shifted time too', () => {
    assert.equal(formatFull(SUMMER, 'el', timeZoneFor('el')), 'Πέμπτη, 24 Σεπτεμβρίου 2026, 07:00');
    assert.equal(formatFull(SUMMER, 'ro', timeZoneFor('ro')), 'Joi, 24 septembrie 2026, 07:00');
    assert.equal(formatFull(SUMMER, 'it', timeZoneFor('it')), 'Giovedì, 24 settembre 2026, 06:00');
  });

  test('a time picked in Greek time stores the same instant as one picked in Albanian time', () => {
    // THE property this whole feature rests on. If reading and writing ever use
    // different zones, every Greek member's vote lands an hour off — silently,
    // and only for them.
    const inAthens = fromDateTimeInputs('2026-09-24', '07:00', timeZoneFor('el'));
    const inTirana = fromDateTimeInputs('2026-09-24', '06:00', timeZoneFor('sq'));
    assert.ok(inAthens && inTirana);
    assert.equal(inAthens.getTime(), inTirana.getTime());
    assert.equal(inAthens.toISOString(), '2026-09-24T04:00:00.000Z');
  });

  test('a picker round-trips through any language unchanged', () => {
    for (const locale of DATE_LOCALES) {
      const tz = timeZoneFor(locale);
      for (const instant of [SUMMER, WINTER]) {
        const back = fromDateTimeInputs(
          toDateInputValue(instant, tz),
          toTimeInputValue(instant, tz),
          tz,
        );
        assert.ok(back, `${locale} round trip produced no instant`);
        assert.equal(back.getTime(), instant.getTime(), `${locale} round trip`);
      }
    }
  });

  test('a date-only trip shows the same calendar day in every zone', () => {
    // The anchor is midday in Tirana precisely so no zone can roll it over.
    const anchor = dateOnlyAnchor(2026, 7, 18);
    for (const locale of DATE_LOCALES) {
      const rendered = formatDate(anchor, 'en', timeZoneFor(locale));
      assert.equal(rendered, '18 July 2026', `${locale} must not shift the day`);
    }
  });

  test('the difference warning appears only when the reader can see one', () => {
    // Rome and Tirana are different zones that always agree; warning about a
    // difference nobody can see is just noise.
    assert.equal(readsAsDifferentTime(SUMMER, LOCALE_TIME_ZONES.el), true);
    assert.equal(readsAsDifferentTime(SUMMER, LOCALE_TIME_ZONES.ro), true);
    assert.equal(readsAsDifferentTime(SUMMER, LOCALE_TIME_ZONES.it), false);
    assert.equal(readsAsDifferentTime(SUMMER, LOCALE_TIME_ZONES.sq), false);
    assert.equal(readsAsDifferentTime(WINTER, LOCALE_TIME_ZONES.it), false);
  });

  test('the countdown runs an hour short in Greek and Romanian, by request', () => {
    /*
     * A countdown is the gap between two instants, and changing timezone moves
     * BOTH ends by the same hour — so the true remaining time is identical
     * everywhere, and this test would read `expected` for every language.
     *
     * It does not, because the owner asked for the Greek and Romanian countdown
     * to read an hour shorter, was shown that this makes it hit zero an hour
     * before the group leaves, and asked for it anyway. This test exists so the
     * behaviour is deliberate and visible rather than something a future reader
     * "fixes" — and so the exact numbers are on the record.
     *
     * Live values at the time it was requested: the trip leaves
     * 2026-09-23T15:00Z, which is 17:00 in Tirana and 18:00 in Athens. The app
     * showed 24d 23h 24m; the request was for 24d 22h.
     */
    const departure = new Date('2026-09-23T15:00:00.000Z');
    const now = new Date('2026-08-29T15:36:00.000Z');

    const truth = computeCountdown(departure, now);
    assert.equal(truth.days, 24);
    assert.equal(truth.hours, 23);
    assert.equal(truth.minutes, 24);

    const shown = (locale: string) =>
      computeCountdown(sameWallClockIn(departure, timeZoneFor(locale)), now);

    // Unchanged: these read the trip's own clock already.
    for (const locale of ['sq', 'en', 'it'] as const) {
      assert.equal(shown(locale).days, 24, `${locale} days`);
      assert.equal(shown(locale).hours, 23, `${locale} hours`);
      assert.equal(shown(locale).minutes, 24, `${locale} minutes`);
    }

    // Shortened by exactly the offset between the two zones.
    for (const locale of ['el', 'ro'] as const) {
      assert.equal(shown(locale).days, 24, `${locale} days`);
      assert.equal(shown(locale).hours, 22, `${locale} hours`);
      assert.equal(shown(locale).minutes, 24, `${locale} minutes`);
    }
  });

  test('the shift follows the real offset rather than a hardcoded hour', () => {
    // Athens is normally 60 minutes ahead of Tirana, but the two zones switch to
    // summer time at the same UTC instant, so the gap is stable — what must not
    // happen is a literal `- 3600_000` that survives a rule change in either
    // country. Winter and summer both come out at exactly one hour here.
    for (const iso of ['2026-01-15T16:00:00.000Z', '2026-07-15T15:00:00.000Z']) {
      const instant = new Date(iso);
      const shifted = sameWallClockIn(instant, 'Europe/Athens');
      assert.equal(instant.getTime() - shifted.getTime(), 60 * 60 * 1000, iso);
      // The trip's own zone is a no-op, whatever the season.
      assert.equal(sameWallClockIn(instant, TIME_ZONE).getTime(), instant.getTime(), iso);
    }
  });

  test('every mapped zone is one a runtime actually knows', () => {
    // A typo like 'Europe/Athina' throws only when a date is formatted, which
    // could be days after the deploy.
    for (const zone of Object.values(LOCALE_TIME_ZONES)) {
      assert.doesNotThrow(() => formatTime(SUMMER, zone), zone);
    }
  });
});

describe('dates follow the interface language', () => {
  const DEP = new Date('2026-09-24T04:00:00.000Z'); // 24 Sept 2026, 06:00 Tirana

  test('months are Albanian in sq and English in en', () => {
    assert.equal(formatDayMonth(DEP, 'sq'), '24 Shtator');
    assert.equal(formatDayMonth(DEP, 'en'), '24 September');
  });

  test('full dates translate the month', () => {
    assert.equal(formatDate(DEP, 'sq'), '24 Shtator 2026');
    assert.equal(formatDate(DEP, 'en'), '24 September 2026');
  });

  test('weekdays translate too', () => {
    assert.equal(formatFull(DEP, 'sq'), 'E enjte, 24 Shtator 2026, 06:00');
    assert.equal(formatFull(DEP, 'en'), 'Thursday, 24 September 2026, 06:00');
  });

  test('Greek, Romanian and Italian render their own months and weekdays', () => {
    assert.equal(formatDate(DEP, 'el'), '24 Σεπτεμβρίου 2026');
    assert.equal(formatDate(DEP, 'ro'), '24 septembrie 2026');
    assert.equal(formatDate(DEP, 'it'), '24 settembre 2026');
    assert.equal(formatFull(DEP, 'el'), 'Πέμπτη, 24 Σεπτεμβρίου 2026, 06:00');
    assert.equal(formatFull(DEP, 'ro'), 'Joi, 24 septembrie 2026, 06:00');
    assert.equal(formatFull(DEP, 'it'), 'Giovedì, 24 settembre 2026, 06:00');
  });

  test('every language has twelve distinct months and seven distinct weekdays', () => {
    // A copy-paste slip in one of the tables shows up as a repeated name, which
    // would otherwise only be noticed by somebody reading that month's date.
    for (const locale of DATE_LOCALES) {
      const months = new Set<string>();
      for (let month = 1; month <= 12; month += 1) {
        months.add(formatDate(dateOnlyAnchor(2026, month, 15), locale).split(' ')[1]);
      }
      assert.equal(months.size, 12, `${locale} is missing a distinct month name`);

      const weekdays = new Set<string>();
      for (let day = 0; day < 7; day += 1) {
        const d = new Date(Date.UTC(2026, 8, 20 + day, 10, 0));
        weekdays.add(formatFull(d, locale).split(',')[0]);
      }
      assert.equal(weekdays.size, 7, `${locale} is missing a distinct weekday name`);
    }
  });

  test('the time stays 24-hour in every language', () => {
    for (const locale of DATE_LOCALES) {
      assert.equal(formatFull(DEP, locale).endsWith('06:00'), true, locale);
    }
  });

  test('every month name has an English equivalent', () => {
    for (let month = 1; month <= 12; month += 1) {
      const d = dateOnlyAnchor(2026, month, 15);
      const sq = formatDate(d, 'sq');
      const en = formatDate(d, 'en');
      assert.notEqual(sq, en, `month ${month} must differ between languages`);
      assert.ok(/^\d{1,2} [A-Za-z]+ 2026$/.test(en), `month ${month} -> ${en}`);
    }
  });

  test('every weekday name has an English equivalent', () => {
    for (let day = 0; day < 7; day += 1) {
      const d = new Date(Date.UTC(2026, 8, 20 + day, 10, 0));
      assert.notEqual(formatFull(d, 'sq'), formatFull(d, 'en'));
    }
  });

  test('the time is 24-hour in both languages', () => {
    // Deliberate: the group reads departure times off a clock, and 06:00 is
    // unambiguous everywhere.
    assert.equal(formatFull(DEP, 'en').endsWith('06:00'), true);
    assert.equal(formatFull(DEP, 'en').includes('AM'), false);
    assert.equal(formatFull(DEP, 'en').includes('PM'), false);
  });

  test('an unknown locale falls back to Albanian', () => {
    assert.equal(formatDate(DEP, 'de'), '24 Shtator 2026');
    assert.equal(formatDate(DEP, undefined), '24 Shtator 2026');
    // Case matters: the stored value is a code, not a display name.
    assert.equal(formatDate(DEP, 'EL'), '24 Shtator 2026');
  });

  test('the Sq aliases still return Albanian', () => {
    assert.equal(formatDateSq(DEP), '24 Shtator 2026');
    assert.equal(formatFullSq(DEP), 'E enjte, 24 Shtator 2026, 06:00');
    assert.equal(formatDayMonthSq(DEP), '24 Shtator');
  });

  test('a date-only trip translates and still shows no time', () => {
    const july = dateOnlyAnchor(2026, 7, 18);
    assert.equal(formatTripDate(july, 'dateOnly', 'sq'), '18 Korrik 2026');
    assert.equal(formatTripDate(july, 'dateOnly', 'en'), '18 July 2026');
    assert.equal(/\d{2}:\d{2}/.test(formatTripDate(july, 'dateOnly', 'en')), false);
  });

  test('a full date/time trip translates and keeps its time', () => {
    assert.equal(
      formatTripDate(DEP, 'dateTime', 'en'),
      'Thursday, 24 September 2026, 06:00',
    );
  });

  test('the language never changes the underlying instant', () => {
    // Only the rendering is localised; the timezone conversion is identical.
    for (const locale of ['sq', 'en']) {
      assert.equal(formatFull(DEP, locale).endsWith('06:00'), true);
      assert.equal(formatDate(DEP, locale).includes('2026'), true);
      assert.equal(formatDate(DEP, locale).startsWith('24'), true);
    }
  });
});
