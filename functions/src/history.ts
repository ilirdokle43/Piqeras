/**
 * Trip history: completing a live trip, and recording trips that predate the
 * app.
 *
 * Both operations write attendee snapshots, which Firestore rules deny to every
 * client — so this file is the only way history can come into existence, and
 * the only way it can change.
 */

import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import * as logger from 'firebase-functions/logger';
import { REGION } from './config';
import {
  countsAsAttendee,
  isTripVisible,
  type Attendance,
  type DatePrecision,
  type TripStatus,
} from './domain';

/* ------------------------------------------------------------- helpers --- */

function requireGoogle(req: CallableRequest<unknown>): string {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Duhet të identifikohesh me Google.');
  const identities = (req.auth?.token as { firebase?: { identities?: Record<string, unknown> } })
    ?.firebase?.identities;
  if (!identities || !('google.com' in identities)) {
    throw new HttpsError('permission-denied', 'Kërkohet një llogari Google.');
  }
  return uid;
}

async function requireOrganizer(req: CallableRequest<unknown>): Promise<string> {
  const uid = requireGoogle(req);
  const db = getFirestore();
  const [organizer, member] = await Promise.all([
    db.collection('organizers').doc(uid).get(),
    db.collection('approvedMembers').doc(uid).get(),
  ]);
  if (!organizer.exists || !member.exists) {
    throw new HttpsError('permission-denied', 'Vetëm organizatorët mund ta bëjnë këtë.');
  }
  return uid;
}

interface AttendeeInput {
  displayName?: string;
  uid?: string | null;
  attendance?: string;
  note?: string | null;
  preferredDeparture?: string | null;
}

/**
 * Normalises one attendee snapshot.
 *
 * Never carries an email: history is readable by the whole group, so an address
 * must not be in it. A historical friend needs no Firebase account — `uid` is
 * present only when one genuinely exists.
 */
function normalizeAttendee(input: AttendeeInput, index: number) {
  const displayName = String(input.displayName ?? '').trim().replace(/\s+/g, ' ');
  if (displayName.length < 1 || displayName.length > 60) {
    throw new HttpsError('invalid-argument', `Emri i pjesëmarrësit ${index + 1} është i pavlefshëm.`);
  }
  const attendance = (input.attendance ?? 'yes') as Attendance;
  if (!['yes', 'maybe', 'no'].includes(attendance)) {
    throw new HttpsError('invalid-argument', `Statusi i ${displayName} është i pavlefshëm.`);
  }

  let preferredDeparture: Timestamp | null = null;
  if (input.preferredDeparture) {
    const d = new Date(input.preferredDeparture);
    if (Number.isNaN(d.getTime())) {
      throw new HttpsError('invalid-argument', `Ora e ${displayName} është e pavlefshme.`);
    }
    preferredDeparture = Timestamp.fromDate(d);
  }

  const note = input.note ? String(input.note).slice(0, 140) : null;
  const uid = input.uid ? String(input.uid) : null;

  return {
    docId: uid ?? `manual_${index}_${displayName.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`.slice(0, 80),
    data: {
      ...(uid ? { uid } : {}),
      displayName,
      attendance,
      note,
      preferredDeparture,
      source: uid ? ('response' as const) : ('manual' as const),
      createdAt: FieldValue.serverTimestamp(),
    },
  };
}

/* --------------------------------------------------------- completeTrip -- */

/**
 * Turns the live trip into history, atomically.
 *
 * Everything happens inside one Firestore transaction: if any part fails, the
 * trip stays exactly as it was rather than half-completed with some snapshots
 * written and the status not moved.
 *
 * The original responses are NOT deleted — the snapshots are a parallel,
 * immutable record, so the raw vote data survives for audit.
 */
export const completeTrip = onCall(
  { region: REGION },
  async (req: CallableRequest<{ tripId?: string; includeMaybe?: boolean }>) => {
    const callerUid = await requireOrganizer(req);
    const tripId = req.data?.tripId;
    if (!tripId) throw new HttpsError('invalid-argument', 'tripId mungon.');

    // Explicit, never inferred: the dashboard asks before confirming.
    const includeMaybe = req.data?.includeMaybe === true;

    const db = getFirestore();
    const tripRef = db.collection('trips').doc(tripId);

    const result = await db.runTransaction(async (tx) => {
      const trip = await tx.get(tripRef);
      if (!trip.exists) throw new HttpsError('not-found', 'Dalja nuk u gjet.');

      const status = trip.get('status') as TripStatus;
      if (status === 'completed' || status === 'archived') {
        throw new HttpsError('failed-precondition', 'Kjo dalje është përfunduar tashmë.');
      }
      if (status === 'draft') {
        throw new HttpsError('failed-precondition', 'Një draft nuk mund të përfundohet.');
      }

      const responses = await tx.get(tripRef.collection('responses'));

      let attendeeCount = 0;
      for (const r of responses.docs) {
        const attendance = r.get('attendance') as Attendance;
        // "Maybe" is included only when the organizer said so; "no" is stored
        // for the audit trail but never counted as an attendee.
        if (attendance === 'maybe' && !includeMaybe) continue;

        const snapshotRef = tripRef.collection('attendees').doc(r.id);
        tx.set(snapshotRef, {
          uid: r.id,
          displayName: (r.get('displayName') as string) ?? '',
          attendance,
          note: (r.get('note') as string | null) ?? null,
          preferredDeparture: r.get('preferredDeparture') ?? null,
          source: 'response',
          createdAt: FieldValue.serverTimestamp(),
        });
        if (countsAsAttendee(attendance)) attendeeCount += 1;
      }

      tx.update(tripRef, {
        status: 'completed',
        visible: true, // invariant: visible === (status !== 'draft')
        votingLocked: true,
        isCurrent: false,
        attendeeCount,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: callerUid,
      });

      return { attendeeCount, responseCount: responses.size };
    });

    logger.info('trip completed', { tripId, by: callerUid, includeMaybe, ...result });
    return { ok: true, ...result };
  },
);

/* -------------------------------------------------- saveHistoricalTrip --- */

interface HistoricalTripInput {
  tripId?: string | null;
  title?: string;
  destination?: string;
  description?: string | null;
  memory?: string | null;
  /** ISO instant. For dateOnly trips this is the 12:00 Europe/Tirane anchor. */
  tripDate?: string;
  datePrecision?: DatePrecision;
  returnDate?: string | null;
  finalDeparture?: string | null;
  attendees?: AttendeeInput[];
}

/**
 * Creates or edits a completed trip that happened before the app existed.
 *
 * Replaces the attendee list wholesale, which is what makes an edit
 * predictable: the organizer sees the list they are saving. Audit fields are
 * preserved server-side — `createdAt`/`createdBy` survive every edit, and
 * `updatedBy` is taken from the verified caller, never from the payload.
 */
export const saveHistoricalTrip = onCall(
  { region: REGION },
  async (req: CallableRequest<HistoricalTripInput>) => {
    const callerUid = await requireOrganizer(req);
    const d = req.data ?? {};

    const title = String(d.title ?? '').trim();
    const destination = String(d.destination ?? '').trim();
    if (title.length < 1 || title.length > 60) {
      throw new HttpsError('invalid-argument', 'Titulli është i pavlefshëm.');
    }
    if (destination.length < 1 || destination.length > 60) {
      throw new HttpsError('invalid-argument', 'Destinacioni është i pavlefshëm.');
    }

    const datePrecision = (d.datePrecision ?? 'dateOnly') as DatePrecision;
    if (datePrecision !== 'dateOnly' && datePrecision !== 'dateTime') {
      throw new HttpsError('invalid-argument', 'datePrecision i pavlefshëm.');
    }

    if (!d.tripDate) throw new HttpsError('invalid-argument', 'Data e daljes mungon.');
    const tripDate = new Date(d.tripDate);
    if (Number.isNaN(tripDate.getTime())) {
      throw new HttpsError('invalid-argument', 'Data e daljes është e pavlefshme.');
    }
    const year = tripDate.getUTCFullYear();
    if (year < 2000 || year >= 2100) {
      throw new HttpsError('invalid-argument', 'Data e daljes është jashtë intervalit.');
    }

    const optionalDate = (value: string | null | undefined, label: string) => {
      if (!value) return null;
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) {
        throw new HttpsError('invalid-argument', `${label} është e pavlefshme.`);
      }
      return Timestamp.fromDate(parsed);
    };

    const returnDate = optionalDate(d.returnDate, 'Data e kthimit');
    // A departure time is only meaningful when the time is actually known.
    const finalDeparture =
      datePrecision === 'dateTime' ? optionalDate(d.finalDeparture, 'Ora e nisjes') : null;

    const attendees = (d.attendees ?? []).map(normalizeAttendee);
    const attendeeCount = attendees.filter((a) =>
      countsAsAttendee(a.data.attendance),
    ).length;

    const db = getFirestore();
    const isNew = !d.tripId;
    const tripRef = isNew ? db.collection('trips').doc() : db.collection('trips').doc(d.tripId!);

    await db.runTransaction(async (tx) => {
      const existing = await tx.get(tripRef);
      if (!isNew && !existing.exists) {
        throw new HttpsError('not-found', 'Dalja nuk u gjet.');
      }

      // Replacing the list means clearing what is there first, so an edit that
      // removes somebody actually removes them.
      const current = await tx.get(tripRef.collection('attendees'));
      for (const doc of current.docs) tx.delete(doc.ref);

      const payload: Record<string, unknown> = {
        title,
        destination,
        description: d.description ? String(d.description).slice(0, 500) : null,
        memory: d.memory ? String(d.memory).slice(0, 1000) : null,
        status: 'completed',
        visible: isTripVisible('completed'),
        datePrecision,
        proposedDeparture: Timestamp.fromDate(tripDate),
        finalDeparture,
        returnDate,
        votingDeadline: null,
        votingLocked: true,
        isCurrent: false,
        attendeeCount,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: callerUid,
      };

      if (isNew) {
        payload.createdAt = FieldValue.serverTimestamp();
        payload.createdBy = callerUid;
        payload.responseCounts = { yes: 0, maybe: 0, no: 0 };
        payload.respondedCount = 0;
        tx.set(tripRef, payload);
      } else {
        // createdAt / createdBy are deliberately absent, so an edit can never
        // rewrite who first recorded the trip or when.
        tx.set(tripRef, payload, { merge: true });
      }

      for (const attendee of attendees) {
        tx.set(tripRef.collection('attendees').doc(attendee.docId), attendee.data);
      }
    });

    logger.info('historical trip saved', {
      tripId: tripRef.id,
      by: callerUid,
      isNew,
      attendees: attendees.length,
      attendeeCount,
    });
    return { ok: true, tripId: tripRef.id, attendeeCount };
  },
);

/* ------------------------------------------------------ attendee count --- */

/**
 * Keeps `attendeeCount` in step with the snapshots.
 *
 * Recomputed from scratch rather than incremented, for the same reason as the
 * response counters: a drifting count on a history card is worse than a few
 * extra reads, and triggers can be delivered more than once.
 */
export const onAttendeeWritten = onDocumentWritten(
  { document: 'trips/{tripId}/attendees/{attendeeId}', region: REGION },
  async (event) => {
    const tripId = event.params.tripId;
    const db = getFirestore();
    const tripRef = db.collection('trips').doc(tripId);

    await db.runTransaction(async (tx) => {
      const trip = await tx.get(tripRef);
      if (!trip.exists) return;

      const all = await tx.get(tripRef.collection('attendees'));
      let count = 0;
      for (const d of all.docs) {
        if (countsAsAttendee(d.get('attendance') as Attendance)) count += 1;
      }
      tx.update(tripRef, { attendeeCount: count });
    });

    logger.debug('attendee count recomputed', { tripId });
  },
);
