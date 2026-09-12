/**
 * Firestore triggers: response counters, denormalised name sync, and the
 * trip-change notifications.
 */

import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { onDocumentWritten, onDocumentCreated } from 'firebase-functions/v2/firestore';
import * as logger from 'firebase-functions/logger';
import { REGION } from './config';
import { notifyOnce, bundleFor } from './notify';
import {
  effectiveDeparture,
  isTripActive,
  type Attendance,
  type TripStatus,
} from './domain';
import { reconcileClaim } from './organizers';

const toDate = (v: unknown): Date | null =>
  v instanceof Timestamp ? v.toDate() : null;

/**
 * Keeps `responseCounts` and `respondedCount` on the trip in step with the
 * responses subcollection.
 *
 * Recomputed from scratch inside a transaction rather than incremented: a
 * counter that drifts is worse than one that costs a few extra reads, the
 * collection holds one document per member, and Firestore triggers can be
 * delivered more than once, which would double any naive increment.
 */
export const onResponseWritten = onDocumentWritten(
  { document: 'trips/{tripId}/responses/{uid}', region: REGION },
  async (event) => {
    const tripId = event.params.tripId;
    const db = getFirestore();
    const tripRef = db.collection('trips').doc(tripId);
    const responsesRef = tripRef.collection('responses');

    await db.runTransaction(async (tx) => {
      const trip = await tx.get(tripRef);
      if (!trip.exists) return; // trip removed mid-flight; nothing to update

      const all = await tx.get(responsesRef);
      const counts: Record<Attendance, number> = { yes: 0, maybe: 0, no: 0 };
      for (const d of all.docs) {
        const a = d.get('attendance') as Attendance;
        if (a === 'yes' || a === 'maybe' || a === 'no') counts[a] += 1;
      }

      tx.update(tripRef, {
        responseCounts: counts,
        respondedCount: all.size,
      });
    });

    logger.debug('response counters recomputed', { tripId });
  },
);

/**
 * Propagates a display-name change into the places it was denormalised.
 *
 * Responses carry the name so the group screen renders from a single realtime
 * listener with no per-row join. That copy has to be maintained, and here is
 * where it happens.
 *
 * Trips are iterated and read by document id rather than reached with a
 * collection-group query on `uid`: collection-group queries need an explicitly
 * declared single-field index, and the trip count here is a handful per year.
 */
export const onUserWritten = onDocumentWritten(
  { document: 'users/{uid}', region: REGION },
  async (event) => {
    const uid = event.params.uid;
    const before = event.data?.before;
    const after = event.data?.after;
    if (!after?.exists) return;

    const newName = after.get('displayName') as string | undefined;
    const oldName = before?.exists ? (before.get('displayName') as string | undefined) : undefined;
    if (!newName || newName === oldName) return;

    const db = getFirestore();
    const batch = db.batch();
    let touched = 0;

    const trips = await db.collection('trips').get();
    for (const trip of trips.docs) {
      // Only live trips. A response on a completed, cancelled or archived trip
      // is a historical record of who went and under what name — renaming
      // yourself in 2027 must not rewrite the 2026 attendance list.
      if (!isTripActive(trip.get('status') as TripStatus)) continue;

      const responseRef = trip.ref.collection('responses').doc(uid);
      const snap = await responseRef.get();
      if (snap.exists) {
        batch.update(responseRef, { displayName: newName });
        touched += 1;
      }
    }

    for (const collection of ['organizers', 'approvedMembers']) {
      const ref = db.collection(collection).doc(uid);
      if ((await ref.get()).exists) {
        batch.update(ref, { displayName: newName });
        touched += 1;
      }
    }

    if (touched > 0) await batch.commit();
    logger.info('display name propagated', { uid, newName, touched });
  },
);

/**
 * Notifies the group when a trip appears or its official departure moves.
 *
 * The actor is excluded from the fan-out — the organizer who just pressed
 * "confirm" does not need a push telling them what they did.
 */
export const onTripWritten = onDocumentWritten(
  { document: 'trips/{tripId}', region: REGION },
  async (event) => {
    const tripId = event.params.tripId;
    const before = event.data?.before;
    const after = event.data?.after;
    if (!after?.exists) return;

    const status = after.get('status') as TripStatus;
    if (status === 'draft') return; // drafts are private to the organizer

    const title = (after.get('title') as string) ?? 'Piqeras';
    const actor = after.get('updatedBy') as string | undefined;

    const afterDeparture = effectiveDeparture({
      finalDeparture: toDate(after.get('finalDeparture')),
      proposedDeparture: toDate(after.get('proposedDeparture')) ?? new Date(),
    });

    const wasVisible = before?.exists && (before.get('status') as TripStatus) !== 'draft';

    // 1. A new trip (or one published out of draft).
    if (!wasVisible) {
      await notifyOnce({
        eventKey: `trip_created:${tripId}`,
        type: 'trip_created',
        tripId,
        exceptUid: actor ?? null,
        build: (locale) => bundleFor(locale).tripCreated(title, afterDeparture),
        data: { departure: afterDeparture.toISOString() },
      });
      return;
    }

    const beforeDeparture = effectiveDeparture({
      finalDeparture: toDate(before!.get('finalDeparture')),
      proposedDeparture: toDate(before!.get('proposedDeparture')) ?? new Date(),
    });
    const beforeLocked = before!.get('votingLocked') === true;
    const afterLocked = after.get('votingLocked') === true;
    const beforeStatus = before!.get('status') as TripStatus;

    const justConfirmed =
      (afterLocked && !beforeLocked) || (status === 'confirmed' && beforeStatus !== 'confirmed');

    // 2. Voting closed and the date is final. This supersedes a plain
    //    "departure changed" push so the group gets one message, not two.
    if (justConfirmed) {
      await notifyOnce({
        eventKey: `voting_locked:${tripId}:${afterDeparture.getTime()}`,
        type: 'voting_locked',
        tripId,
        exceptUid: actor ?? null,
        build: (locale) => bundleFor(locale).votingLocked(title, afterDeparture),
        data: { departure: afterDeparture.toISOString() },
      });
      return;
    }

    // 3. The official departure moved while voting was still open.
    if (afterDeparture.getTime() !== beforeDeparture.getTime()) {
      await notifyOnce({
        eventKey: `departure_changed:${tripId}:${afterDeparture.getTime()}`,
        type: 'departure_changed',
        tripId,
        exceptUid: actor ?? null,
        build: (locale) => bundleFor(locale).departureChanged(title, afterDeparture),
        data: { departure: afterDeparture.toISOString() },
      });
    }
  },
);

/**
 * Repairs the organizer custom claim whenever the server-owned collection
 * changes, including changes made by tools/grant-organizer.mjs outside the
 * callable.
 */
export const onOrganizerWritten = onDocumentWritten(
  { document: 'organizers/{uid}', region: REGION },
  async (event) => {
    const uid = event.params.uid;
    await reconcileClaim(uid, event.data?.after?.exists === true);
  },
);

/** Exported for the emulator smoke tests. */
export const _internal = { FieldValue };

/**
 * Tells the organizers that somebody is waiting for approval.
 *
 * Sent only to organizers — the rest of the group has no reason to know, and
 * the pending person's name is not public until they are approved.
 */
export const onPendingMemberCreated = onDocumentCreated(
  { document: 'pendingMembers/{uid}', region: REGION },
  async (event) => {
    const uid = event.params.uid;
    const name = (event.data?.get('googleName') as string) || 'Dikush';

    await notifyOnce({
      eventKey: `access_requested:${uid}`,
      type: 'access_requested',
      tripId: '-',
      audience: 'organizers',
      build: (locale) => bundleFor(locale).accessRequested(name),
      data: { pendingUid: uid },
    });
  },
);
