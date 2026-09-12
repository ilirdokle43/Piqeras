/**
 * Organizer role management.
 *
 * This is the only code path in the system that can create an organizer, and it
 * runs on the server. Firestore rules deny every client write to
 * `organizers/**`, so there is no second door: a member cannot promote
 * themselves by editing data, and neither can an organizer promote someone by
 * writing Firestore directly — they must come through this callable, which
 * re-checks their own role with the Admin SDK against the same server-owned
 * collection.
 */

import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { REGION } from './config';

async function isOrganizer(uid: string): Promise<boolean> {
  const db = getFirestore();
  const [organizer, member] = await Promise.all([
    db.collection('organizers').doc(uid).get(),
    db.collection('approvedMembers').doc(uid).get(),
  ]);
  // Organizer powers require approved membership too, matching the rules.
  return organizer.exists && member.exists;
}

/**
 * Mirrors the role into a custom claim.
 *
 * The claim is *not* what Firestore rules trust — they call exists() so a
 * revocation takes effect immediately. The claim exists because Storage rules
 * cannot read Firestore, and because the clients want a synchronous hint for
 * showing or hiding organizer UI.
 */
async function setOrganizerClaim(uid: string, organizer: boolean): Promise<void> {
  const user = await getAuth().getUser(uid);
  const claims = { ...(user.customClaims ?? {}) };
  if (organizer) {
    claims.organizer = true;
  } else {
    delete claims.organizer;
  }
  await getAuth().setCustomUserClaims(uid, claims);
}

export const manageOrganizer = onCall(
  { region: REGION },
  async (req: CallableRequest<{ targetUid?: string; action?: string }>) => {
    const callerUid = req.auth?.uid;
    if (!callerUid) {
      throw new HttpsError('unauthenticated', 'Duhet të jesh i identifikuar.');
    }
    if (!(await isOrganizer(callerUid))) {
      throw new HttpsError('permission-denied', 'Vetëm organizatorët mund ta bëjnë këtë.');
    }

    const targetUid = req.data?.targetUid;
    const action = req.data?.action;
    if (!targetUid || typeof targetUid !== 'string') {
      throw new HttpsError('invalid-argument', 'targetUid mungon.');
    }
    if (action !== 'grant' && action !== 'revoke') {
      throw new HttpsError('invalid-argument', 'action duhet të jetë grant ose revoke.');
    }

    const db = getFirestore();
    const targetRef = db.collection('organizers').doc(targetUid);

    if (action === 'grant') {
      const userSnap = await db.collection('users').doc(targetUid).get();
      if (!userSnap.exists) {
        throw new HttpsError('not-found', 'Ky përdorues nuk ekziston.');
      }
      // Only an approved member can be promoted. Otherwise a pending — or
      // removed — account could be handed the keys.
      if (!(await db.collection('approvedMembers').doc(targetUid).get()).exists) {
        throw new HttpsError(
          'failed-precondition',
          'Ky përdorues nuk është anëtar i miratuar.',
        );
      }
      await targetRef.set({
        uid: targetUid,
        displayName: userSnap.get('displayName') ?? '',
        grantedAt: FieldValue.serverTimestamp(),
        grantedBy: callerUid,
      });
      await setOrganizerClaim(targetUid, true);
      logger.info('organizer granted', { targetUid, by: callerUid });
      return { ok: true, action, targetUid };
    }

    // Revoking the last organizer would leave the group with no one able to
    // create or confirm a trip, and no client-side path to fix it.
    const all = await db.collection('organizers').get();
    if (all.size <= 1) {
      throw new HttpsError(
        'failed-precondition',
        'Nuk mund të hiqet organizatori i fundit.',
      );
    }
    if (!all.docs.some((d) => d.id === targetUid)) {
      throw new HttpsError('not-found', 'Ky përdorues nuk është organizator.');
    }

    await targetRef.delete();
    await setOrganizerClaim(targetUid, false);
    logger.info('organizer revoked', { targetUid, by: callerUid });
    return { ok: true, action, targetUid };
  },
);

/**
 * Repairs the custom claim if it ever drifts from the collection — for example
 * after `tools/grant-organizer.mjs` writes the document while the user is
 * signed out. Firestore stays the source of truth in both directions.
 */
export async function reconcileClaim(uid: string, shouldBeOrganizer: boolean): Promise<void> {
  try {
    const user = await getAuth().getUser(uid);
    const has = user.customClaims?.organizer === true;
    if (has !== shouldBeOrganizer) {
      await setOrganizerClaim(uid, shouldBeOrganizer);
      logger.info('organizer claim reconciled', { uid, shouldBeOrganizer });
    }
  } catch (err) {
    logger.warn('could not reconcile organizer claim', { uid, err: String(err) });
  }
}
