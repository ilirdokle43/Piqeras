/**
 * The notification pipeline.
 *
 * Two properties matter more than anything else here:
 *
 *  1. **Exactly once per event.** Every send is gated on creating
 *     `notificationEvents/{eventKey}`. The create happens inside a transaction
 *     and fails if the document exists, so a retried trigger — and Firestore
 *     triggers *are* retried — cannot produce a second notification. The event
 *     key encodes the payload-defining values (e.g. the new departure instant),
 *     so a genuine second change still notifies while a replay does not.
 *
 *  2. **Delivery never blocks the app.** A member who denied notification
 *     permission simply has no token rows; the fan-out sends to nobody and the
 *     rest of the product is unaffected.
 */

import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import * as logger from 'firebase-functions/logger';
import { bundleFor, type Notification } from './messages';

export interface TokenRow {
  token: string;
  platform: 'android' | 'web';
  locale?: string;
  path: string;
}

/**
 * Claims an event key. Returns false when the event was already handled, in
 * which case the caller must send nothing.
 */
export async function claimEvent(
  eventKey: string,
  meta: { type: string; tripId: string },
): Promise<boolean> {
  const db = getFirestore();
  const ref = db.collection('notificationEvents').doc(eventKey);
  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists) {
        throw new AlreadyClaimed();
      }
      tx.create(ref, {
        type: meta.type,
        tripId: meta.tripId,
        status: 'pending',
        sentCount: 0,
        failureCount: 0,
        createdAt: FieldValue.serverTimestamp(),
      });
    });
    return true;
  } catch (err) {
    if (err instanceof AlreadyClaimed) {
      logger.info('notification already sent, skipping', { eventKey });
      return false;
    }
    throw err;
  }
}

class AlreadyClaimed extends Error {}

/** Every registered device, across all members. */
export async function allTokens(): Promise<TokenRow[]> {
  const db = getFirestore();
  const snap = await db.collectionGroup('tokens').get();
  return snap.docs.map((d) => ({
    token: d.get('token') as string,
    platform: (d.get('platform') as 'android' | 'web') ?? 'android',
    locale: d.get('locale') as string | undefined,
    path: d.ref.path,
  }));
}

/** Tokens for everyone except the given uid — used to skip the actor. */
export async function tokensExcept(uid: string | null): Promise<TokenRow[]> {
  const rows = await allTokens();
  if (!uid) return rows;
  return rows.filter((r) => !r.path.startsWith(`users/${uid}/`));
}

/**
 * Tokens belonging to the current organizers.
 *
 * Used for the approval queue alert: a pending person's name is not public
 * until they are approved, so only organizers hear about it.
 */
export async function organizerTokens(): Promise<TokenRow[]> {
  const db = getFirestore();
  const organizers = await db.collection('organizers').get();
  const uids = new Set(organizers.docs.map((d) => d.id));
  if (uids.size === 0) return [];
  const rows = await allTokens();
  return rows.filter((r) => uids.has(r.path.split('/')[1] ?? ''));
}

/**
 * Sends one notification to a set of devices, grouped by locale so each member
 * gets their own language, and prunes tokens FCM reports as dead.
 */
export async function sendToTokens(
  tokens: TokenRow[],
  build: (locale: string | undefined) => Notification,
  data: Record<string, string>,
  eventKey: string,
): Promise<{ sent: number; failed: number }> {
  const db = getFirestore();
  if (tokens.length === 0) {
    await db.collection('notificationEvents').doc(eventKey).set(
      { status: 'sent', sentCount: 0, failureCount: 0 },
      { merge: true },
    );
    return { sent: 0, failed: 0 };
  }

  const byLocale = new Map<string, TokenRow[]>();
  for (const row of tokens) {
    const key = row.locale === 'en' ? 'en' : 'sq';
    const list = byLocale.get(key) ?? [];
    list.push(row);
    byLocale.set(key, list);
  }

  let sent = 0;
  let failed = 0;
  const dead: string[] = [];

  for (const [locale, rows] of byLocale) {
    const notification = build(locale);
    // sendEachForMulticast caps at 500 tokens per call.
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const res = await getMessaging().sendEachForMulticast({
        tokens: chunk.map((r) => r.token),
        notification,
        data: { ...data, eventKey },
        android: {
          priority: 'high',
          notification: { channelId: 'piqeras_trip', tag: data.tripId ?? 'piqeras' },
        },
        webpush: {
          notification: { icon: '/icons/icon-192.png', tag: data.tripId ?? 'piqeras' },
          fcmOptions: { link: '/' },
        },
      });
      sent += res.successCount;
      failed += res.failureCount;
      res.responses.forEach((r, idx) => {
        const code = r.error?.code;
        if (
          code === 'messaging/registration-token-not-registered' ||
          code === 'messaging/invalid-registration-token' ||
          code === 'messaging/invalid-argument'
        ) {
          dead.push(chunk[idx].path);
        }
      });
    }
  }

  if (dead.length) {
    const batch = db.batch();
    for (const path of dead) batch.delete(db.doc(path));
    await batch.commit();
    logger.info('pruned dead FCM tokens', { count: dead.length });
  }

  await db.collection('notificationEvents').doc(eventKey).set(
    {
      status: failed > 0 && sent === 0 ? 'failed' : 'sent',
      sentCount: sent,
      failureCount: failed,
      completedAt: Timestamp.now(),
    },
    { merge: true },
  );

  logger.info('notification fan-out complete', { eventKey, sent, failed });
  return { sent, failed };
}

/** Claim-then-send, the only entry point the triggers should use. */
export async function notifyOnce(opts: {
  eventKey: string;
  type: string;
  tripId: string;
  exceptUid?: string | null;
  /** 'group' (default) reaches every registered device; 'organizers' only theirs. */
  audience?: 'group' | 'organizers';
  build: (locale: string | undefined) => Notification;
  data?: Record<string, string>;
}): Promise<void> {
  const claimed = await claimEvent(opts.eventKey, {
    type: opts.type,
    tripId: opts.tripId,
  });
  if (!claimed) return;

  const tokens =
    opts.audience === 'organizers'
      ? await organizerTokens()
      : await tokensExcept(opts.exceptUid ?? null);
  await sendToTokens(
    tokens,
    opts.build,
    { type: opts.type, tripId: opts.tripId, ...(opts.data ?? {}) },
    opts.eventKey,
  );
}

export { bundleFor };
