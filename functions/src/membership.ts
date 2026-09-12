/**
 * Group membership: requesting access, approving, rejecting and removing.
 *
 * These are the privileged operations. `approvedMembers` and `pendingMembers`
 * are denied to every client for write in the Security Rules, so the only way
 * into — or out of — the group is through this file, where the caller's own
 * role is re-checked server-side with the Admin SDK.
 */

import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { REGION } from './config';
import { isTripActive, maskEmail, type TripStatus } from './domain';

/** Every callable here requires a verified Google identity, like the rules do. */
function requireGoogle(req: CallableRequest<unknown>): string {
  const uid = req.auth?.uid;
  if (!uid) {
    throw new HttpsError('unauthenticated', 'Duhet të identifikohesh me Google.');
  }
  const identities = (req.auth?.token as { firebase?: { identities?: Record<string, unknown> } })
    ?.firebase?.identities;
  if (!identities || !('google.com' in identities)) {
    throw new HttpsError('permission-denied', 'Kërkohet një llogari Google.');
  }
  return uid;
}

async function isApprovedMember(uid: string): Promise<boolean> {
  return (await getFirestore().collection('approvedMembers').doc(uid).get()).exists;
}

async function isOrganizer(uid: string): Promise<boolean> {
  const db = getFirestore();
  const [organizer, member] = await Promise.all([
    db.collection('organizers').doc(uid).get(),
    db.collection('approvedMembers').doc(uid).get(),
  ]);
  // Organizer powers require both records, exactly as the rules do.
  return organizer.exists && member.exists;
}

async function requireOrganizer(req: CallableRequest<unknown>): Promise<string> {
  const uid = requireGoogle(req);
  if (!(await isOrganizer(uid))) {
    throw new HttpsError('permission-denied', 'Vetëm organizatorët mund ta bëjnë këtë.');
  }
  return uid;
}

/* ------------------------------------------------------------ requestAccess */

/**
 * Puts a freshly signed-in Google account into the approval queue.
 *
 * Idempotent, and safe to call on every app start: an already-approved member
 * is told so and no queue entry is created. The Google name and masked email
 * are taken from the verified ID token here on the server, never from the
 * client, so the organizer sees something trustworthy on the approval screen.
 */
export const requestAccess = onCall({ region: REGION }, async (req) => {
  const uid = requireGoogle(req);
  const db = getFirestore();

  if (await isApprovedMember(uid)) {
    return { status: 'approved' as const };
  }

  const pendingRef = db.collection('pendingMembers').doc(uid);
  if ((await pendingRef.get()).exists) {
    return { status: 'pending' as const };
  }

  const token = req.auth?.token as { name?: string; email?: string } | undefined;

  await pendingRef.set({
    uid,
    googleName: (token?.name ?? '').slice(0, 60),
    emailMasked: maskEmail(token?.email),
    requestedAt: FieldValue.serverTimestamp(),
  });

  logger.info('access requested', { uid });
  return { status: 'pending' as const };
});

/* --------------------------------------------------------- manageMembership */

type Action = 'approve' | 'reject' | 'remove';

export const manageMembership = onCall(
  { region: REGION },
  async (req: CallableRequest<{ targetUid?: string; action?: string }>) => {
    const callerUid = await requireOrganizer(req);

    const targetUid = req.data?.targetUid;
    const action = req.data?.action as Action | undefined;
    if (!targetUid || typeof targetUid !== 'string') {
      throw new HttpsError('invalid-argument', 'targetUid mungon.');
    }
    if (action !== 'approve' && action !== 'reject' && action !== 'remove') {
      throw new HttpsError('invalid-argument', 'action i pavlefshëm.');
    }

    const db = getFirestore();
    const pendingRef = db.collection('pendingMembers').doc(targetUid);
    const memberRef = db.collection('approvedMembers').doc(targetUid);
    const userRef = db.collection('users').doc(targetUid);

    if (action === 'approve') {
      const userSnap = await userRef.get();
      await memberRef.set({
        uid: targetUid,
        displayName: (userSnap.get('displayName') as string) ?? '',
        approvedAt: FieldValue.serverTimestamp(),
        approvedBy: callerUid,
      });
      await pendingRef.delete();
      logger.info('member approved', { targetUid, by: callerUid });
      return { ok: true, action };
    }

    // ----- reject and remove both revoke access; neither touches the Auth
    // account, so the person can be invited again later and simply needs to be
    // approved a second time.
    if (action === 'remove') {
      // A sitting organizer must lose the role first. Otherwise revoking
      // membership would silently strip their powers — the rules require both
      // records — which is a confusing way to demote somebody.
      if ((await db.collection('organizers').doc(targetUid).get()).exists) {
        throw new HttpsError(
          'failed-precondition',
          'Hiq më parë rolin e organizatorit, pastaj anëtarësinë.',
        );
      }
      if (targetUid === callerUid) {
        throw new HttpsError('failed-precondition', 'Nuk mund të heqësh veten.');
      }
    }

    const removed = await revokeMembership(targetUid);
    logger.info('membership revoked', { targetUid, by: callerUid, action, ...removed });
    return { ok: true, action, ...removed };
  },
);

/**
 * The full revocation, shared by reject and remove.
 *
 * What it deliberately does NOT do: touch the Firebase Auth account, and touch
 * responses on finished trips. Past attendance is a historical record — the
 * response already carries the display name it was written with, so it survives
 * the profile being deleted and still reads correctly years later.
 */
async function revokeMembership(uid: string): Promise<{
  responsesDeleted: number;
  nameReleased: boolean;
  historicalKept: number;
}> {
  const db = getFirestore();
  const batch = db.batch();

  batch.delete(db.collection('approvedMembers').doc(uid));
  batch.delete(db.collection('pendingMembers').doc(uid));

  let responsesDeleted = 0;
  let historicalKept = 0;

  const trips = await db.collection('trips').get();
  for (const trip of trips.docs) {
    const responseRef = trip.ref.collection('responses').doc(uid);
    if (!(await responseRef.get()).exists) continue;

    if (isTripActive(trip.get('status') as TripStatus)) {
      batch.delete(responseRef);
      responsesDeleted += 1;
    } else {
      // Completed, cancelled or archived: leave the record alone.
      historicalKept += 1;
    }
  }

  // Release the display-name claim so the name is free again, but only if it
  // is still theirs.
  let nameReleased = false;
  const userSnap = await db.collection('users').doc(uid).get();
  const lower = userSnap.get('displayNameLower') as string | undefined;
  if (lower) {
    const claimRef = db.collection('displayNames').doc(lower);
    const claim = await claimRef.get();
    if (claim.exists && claim.get('uid') === uid) {
      batch.delete(claimRef);
      nameReleased = true;
    }
  }

  // The profile goes too, so the person disappears from the roster. Their
  // historical responses keep their own displayName copy.
  if (userSnap.exists) batch.delete(userSnap.ref);

  // Push tokens: stop delivering group notifications to a removed member.
  const tokens = await db.collection('users').doc(uid).collection('tokens').get();
  for (const token of tokens.docs) batch.delete(token.ref);

  await batch.commit();
  return { responsesDeleted, nameReleased, historicalKept };
}

/** Exported for the emulator tests. */
export const _internal = { revokeMembership, maskEmail, Timestamp };
