/**
 * The single scheduled job.
 *
 * It runs every 15 minutes and is deliberately *stateless*: it derives what
 * should happen purely from the current trip documents and the clock, and every
 * notification it might send is gated on the same idempotency ledger as the
 * triggers. Running it twice, or running it after an outage, produces the same
 * result as running it once.
 */

import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as logger from 'firebase-functions/logger';
import {
  REGION,
  TRIP_REMINDER_HOURS,
  VOTING_REMINDER_HOURS,
  COMPLETE_AFTER_DEPARTURE_HOURS,
} from './config';
import { notifyOnce, bundleFor } from './notify';
import { effectiveDeparture, TIME_ZONE, type TripStatus } from './domain';

const HOUR_MS = 60 * 60 * 1000;

const toDate = (v: unknown): Date | null => (v instanceof Timestamp ? v.toDate() : null);

export const tripMaintenance = onSchedule(
  {
    schedule: 'every 15 minutes',
    timeZone: TIME_ZONE,
    region: REGION,
    retryCount: 2,
  },
  async () => {
    const db = getFirestore();
    const now = new Date();

    const snap = await db
      .collection('trips')
      .where('status', 'in', ['voting', 'confirmed'])
      .get();

    for (const doc of snap.docs) {
      const tripId = doc.id;
      const title = (doc.get('title') as string) ?? 'Piqeras';
      const status = doc.get('status') as TripStatus;
      const deadline = toDate(doc.get('votingDeadline'));
      const departure = effectiveDeparture({
        finalDeparture: toDate(doc.get('finalDeparture')),
        proposedDeparture: toDate(doc.get('proposedDeparture')) ?? now,
      });

      // --- voting closes soon -------------------------------------------
      if (deadline) {
        const msToDeadline = deadline.getTime() - now.getTime();
        if (msToDeadline > 0 && msToDeadline <= VOTING_REMINDER_HOURS * HOUR_MS) {
          await notifyOnce({
            eventKey: `voting_closing:${tripId}:${deadline.getTime()}`,
            type: 'voting_closing',
            tripId,
            build: (locale) => bundleFor(locale).votingClosingSoon(title, deadline),
            data: { deadline: deadline.toISOString() },
          });
        }
      }

      // --- trip is approaching -------------------------------------------
      const msToDeparture = departure.getTime() - now.getTime();
      if (msToDeparture > 0 && msToDeparture <= TRIP_REMINDER_HOURS * HOUR_MS) {
        await notifyOnce({
          eventKey: `trip_soon:${tripId}:${TRIP_REMINDER_HOURS}`,
          type: 'trip_soon',
          tripId,
          build: (locale) =>
            bundleFor(locale).tripSoon(title, departure, TRIP_REMINDER_HOURS),
          data: { departure: departure.toISOString() },
        });
      }

      // --- the trip has happened ------------------------------------------
      // Only a confirmed trip auto-completes. One still in voting has no
      // official date, so a passed *proposal* must not retire it.
      if (
        status === 'confirmed' &&
        msToDeparture < -COMPLETE_AFTER_DEPARTURE_HOURS * HOUR_MS
      ) {
        await doc.ref.update({
          status: 'completed',
          isCurrent: false,
          votingLocked: true,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: 'system',
        });
        logger.info('trip auto-completed', { tripId });
      }
    }

    logger.info('trip maintenance finished', { trips: snap.size });
  },
);
