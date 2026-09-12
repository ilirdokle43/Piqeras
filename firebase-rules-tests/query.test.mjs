/**
 * Regression tests for the exact queries the clients issue.
 *
 * Rules that pass a document-by-document test can still reject a real query:
 * Firestore evaluates a `list` against the whole result set, and a rule that
 * reads a field the query does not constrain is not always satisfiable.
 */

import { test, before, after, beforeEach, describe } from 'node:test';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, limit, query, setDoc, Timestamp, where } from 'firebase/firestore';

let testEnv;
const UID = 'uid_member';
const DEPARTURE = Timestamp.fromDate(new Date('2026-09-24T04:00:00.000Z'));

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-piqeras-query',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  });
});

after(async () => testEnv?.cleanup());

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const now = Timestamp.now();
    await setDoc(doc(db, 'users', UID), {
      uid: UID,
      displayName: 'Ana',
      displayNameLower: 'ana',
      createdAt: now,
      updatedAt: now,
    });
    await setDoc(doc(db, 'approvedMembers', UID), {
      uid: UID,
      displayName: 'Ana',
      approvedAt: now,
      approvedBy: 'bootstrap',
    });
    await setDoc(doc(db, 'trips', 'trip_a'), {
      title: 'Piqeras',
      destination: 'Piqeras, Sarandë',
      status: 'voting',
      proposedDeparture: DEPARTURE,
      finalDeparture: null,
      votingDeadline: null,
      votingLocked: false,
      isCurrent: true,
      visible: true,
      datePrecision: 'dateTime',
      responseCounts: { yes: 0, maybe: 0, no: 0 },
      respondedCount: 0,
      createdAt: now,
      createdBy: 'bootstrap',
      updatedAt: now,
      updatedBy: 'bootstrap',
    });
  });
});

function googleContext(uid) {
  return testEnv.authenticatedContext(uid, {
    email: `${uid}@gmail.com`,
    email_verified: true,
    firebase: { identities: { 'google.com': [`sub-${uid}`] }, sign_in_provider: 'google.com' },
  });
}

const asMember = () => googleContext(UID).firestore();

describe('client queries', () => {
  test('the home screen can query the current trip', async () => {
    const db = asMember();
    await assertSucceeds(
      getDocs(
        query(
          collection(db, 'trips'),
          where('visible', '==', true),
          where('isCurrent', '==', true),
          limit(1),
        ),
      ),
    );
  });

  test('the roster query succeeds', async () => {
    await assertSucceeds(getDocs(collection(asMember(), 'users')));
  });

  test('the responses query succeeds', async () => {
    await assertSucceeds(getDocs(collection(asMember(), 'trips', 'trip_a', 'responses')));
  });

  test('the organizers query succeeds', async () => {
    await assertSucceeds(getDocs(collection(asMember(), 'organizers')));
  });

  test('the approved-members query succeeds for a member', async () => {
    await assertSucceeds(getDocs(collection(asMember(), 'approvedMembers')));
  });

  test('a member cannot list pending members', async () => {
    // Only organizers see the approval queue.
    await assertFails(getDocs(collection(asMember(), 'pendingMembers')));
  });

  test('a member can read their own approval record by id', async () => {
    await assertSucceeds(getDoc(doc(asMember(), 'approvedMembers', UID)));
  });

  test('the private profile collection cannot be listed at all', async () => {
    await assertFails(getDocs(collection(asMember(), 'privateProfiles')));
  });
});
