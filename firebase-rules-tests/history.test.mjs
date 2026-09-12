/**
 * Rules tests for Trip History and for the draft-list leak found on 2026-08-26.
 *
 * The leak: `allow list: if isMember()` never inspected the document, so an
 * unfiltered getDocs(collection('trips')) returned drafts to any member. The
 * fix tests `visible` on both get and list, which every client query now
 * constrains. These tests pin that shut.
 *
 * The invariant under test throughout:
 *
 *     visible === (status !== 'draft')
 *
 * Cancelled trips ARE visible — they stay readable, and are excluded from
 * Historiku by the history query rather than by visibility.
 */

import { test, before, after, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from '@firebase/rules-unit-testing';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';

let testEnv;

const ORG = 'uid_organizer';
const MEMBER = 'uid_member';
const PENDING = 'uid_pending';

const CURRENT = Timestamp.fromDate(new Date('2026-09-24T04:00:00.000Z'));
const PAST_2026 = Timestamp.fromDate(new Date('2026-07-18T10:00:00.000Z')); // 12:00 Tirana
const PAST_2025 = Timestamp.fromDate(new Date('2025-08-10T10:00:00.000Z'));

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-piqeras-history',
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

after(async () => testEnv?.cleanup());

function tripFixture(overrides) {
  const now = Timestamp.now();
  return {
    title: 'Piqeras',
    destination: 'Piqeras, Sarandë',
    status: 'completed',
    datePrecision: 'dateTime',
    proposedDeparture: CURRENT,
    finalDeparture: null,
    votingDeadline: null,
    votingLocked: true,
    isCurrent: false,
    visible: true,
    responseCounts: { yes: 0, maybe: 0, no: 0 },
    respondedCount: 0,
    attendeeCount: 0,
    createdAt: now,
    createdBy: ORG,
    updatedAt: now,
    updatedBy: ORG,
    ...overrides,
  };
}

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const now = Timestamp.now();

    for (const uid of [ORG, MEMBER]) {
      await setDoc(doc(db, 'approvedMembers', uid), {
        uid,
        displayName: uid,
        approvedAt: now,
        approvedBy: 'seed',
      });
    }
    await setDoc(doc(db, 'organizers', ORG), {
      uid: ORG,
      displayName: 'Ilir',
      grantedAt: now,
      grantedBy: 'seed',
    });

    await setDoc(
      doc(db, 'trips', 'current'),
      tripFixture({ status: 'voting', isCurrent: true, votingLocked: false, visible: true }),
    );
    await setDoc(
      doc(db, 'trips', 'secret'),
      tripFixture({ status: 'draft', isCurrent: false, visible: false, title: 'SECRET DRAFT' }),
    );
    await setDoc(
      doc(db, 'trips', 'past2026'),
      tripFixture({ proposedDeparture: PAST_2026, datePrecision: 'dateOnly', attendeeCount: 3 }),
    );
    await setDoc(
      doc(db, 'trips', 'past2025'),
      tripFixture({ proposedDeparture: PAST_2025, status: 'archived' }),
    );
    await setDoc(
      doc(db, 'trips', 'scrapped'),
      tripFixture({ status: 'cancelled', visible: true }),
    );

    await setDoc(doc(db, 'trips', 'past2026', 'attendees', MEMBER), {
      uid: MEMBER,
      displayName: 'Ana',
      attendance: 'yes',
      source: 'response',
      createdAt: now,
    });
    await setDoc(doc(db, 'trips', 'past2026', 'attendees', 'manual_1'), {
      displayName: 'Dritan',
      attendance: 'yes',
      source: 'manual',
      createdAt: now,
    });
  });
});

const google = (uid) =>
  testEnv
    .authenticatedContext(uid, {
      email: `${uid}@gmail.com`,
      email_verified: true,
      firebase: { identities: { 'google.com': [`s-${uid}`] }, sign_in_provider: 'google.com' },
    })
    .firestore();

const anonymous = (uid) =>
  testEnv
    .authenticatedContext(uid, { firebase: { identities: {}, sign_in_provider: 'anonymous' } })
    .firestore();

const guest = () => testEnv.unauthenticatedContext().firestore();

const historyQuery = (db) =>
  getDocs(
    query(
      collection(db, 'trips'),
      where('visible', '==', true),
      where('status', 'in', ['completed', 'archived']),
      orderBy('proposedDeparture', 'desc'),
    ),
  );

const visibleQuery = (db) =>
  getDocs(query(collection(db, 'trips'), where('visible', '==', true)));

/* ------------------------------------------------------ the draft leak --- */

describe('REGRESSION: the draft-list leak', () => {
  test('an unfiltered trips query by a member is DENIED', async () => {
    // The exact attack that exposed the leak. It used to succeed and return
    // every draft; it must now be rejected outright.
    await assertFails(getDocs(collection(google(MEMBER), 'trips')));
  });

  test('a member cannot get a draft trip by id', async () => {
    await assertFails(getDoc(doc(google(MEMBER), 'trips', 'secret')));
  });

  test('a member cannot list drafts by filtering for them', async () => {
    await assertFails(
      getDocs(query(collection(google(MEMBER), 'trips'), where('status', '==', 'draft'))),
    );
  });

  test('a member cannot reach a draft by asking for visible == false', async () => {
    await assertFails(
      getDocs(query(collection(google(MEMBER), 'trips'), where('visible', '==', false))),
    );
  });

  test('a visible-constrained query succeeds and excludes the draft', async () => {
    const snap = await assertSucceeds(visibleQuery(google(MEMBER)));
    const ids = snap.docs.map((d) => d.id);
    assert.equal(ids.includes('secret'), false, 'draft must not appear');
    assert.equal(ids.includes('current'), true);
    assert.equal(ids.includes('past2026'), true);
  });

  test('an organizer still reads drafts, unfiltered', async () => {
    const snap = await assertSucceeds(getDocs(collection(google(ORG), 'trips')));
    assert.equal(
      snap.docs.some((d) => d.id === 'secret'),
      true,
      'organizers keep draft access',
    );
  });

  test('an organizer can get a draft by id', async () => {
    await assertSucceeds(getDoc(doc(google(ORG), 'trips', 'secret')));
  });
});

/* --------------------------------------------------- visibility invariant */

describe('the visibility invariant is enforced on every write', () => {
  const base = () => ({
    title: 'Piqeras',
    destination: 'P',
    status: 'draft',
    datePrecision: 'dateTime',
    proposedDeparture: CURRENT,
    votingLocked: false,
    isCurrent: false,
    visible: false,
    createdAt: serverTimestamp(),
    createdBy: ORG,
    updatedAt: serverTimestamp(),
    updatedBy: ORG,
  });

  test('a client cannot publish a draft by setting visible true', async () => {
    await assertFails(
      setDoc(doc(google(ORG), 'trips', 'new'), { ...base(), visible: true }),
    );
  });

  test('a client cannot hide a live trip by setting visible false', async () => {
    await assertFails(
      setDoc(doc(google(ORG), 'trips', 'new'), {
        ...base(),
        status: 'voting',
        visible: false,
      }),
    );
  });

  test('a consistent draft is accepted', async () => {
    await assertSucceeds(setDoc(doc(google(ORG), 'trips', 'new'), base()));
  });

  test('a consistent completed trip is accepted', async () => {
    await assertSucceeds(
      setDoc(doc(google(ORG), 'trips', 'new'), {
        ...base(),
        status: 'completed',
        visible: true,
        votingLocked: true,
      }),
    );
  });

  test('a cancelled trip is visible, by design', async () => {
    await assertSucceeds(
      setDoc(doc(google(ORG), 'trips', 'new'), {
        ...base(),
        status: 'cancelled',
        visible: true,
      }),
    );
  });

  test('a cancelled trip marked invisible is rejected', async () => {
    await assertFails(
      setDoc(doc(google(ORG), 'trips', 'new'), {
        ...base(),
        status: 'cancelled',
        visible: false,
      }),
    );
  });

  test('visible is required — it cannot be omitted', async () => {
    const d = base();
    delete d.visible;
    await assertFails(setDoc(doc(google(ORG), 'trips', 'new'), d));
  });

  test('an update that breaks the invariant is rejected', async () => {
    await assertFails(
      updateDoc(doc(google(ORG), 'trips', 'secret'), {
        visible: true,
        updatedAt: serverTimestamp(),
        updatedBy: ORG,
      }),
    );
  });

  test('flipping a draft to completed must flip visible too', async () => {
    await assertSucceeds(
      updateDoc(doc(google(ORG), 'trips', 'secret'), {
        status: 'completed',
        visible: true,
        updatedAt: serverTimestamp(),
        updatedBy: ORG,
      }),
    );
  });
});

/* ------------------------------------------------------- date precision -- */

describe('date precision', () => {
  test('datePrecision is required', async () => {
    const d = tripFixture({});
    delete d.datePrecision;
    d.createdAt = serverTimestamp();
    d.updatedAt = serverTimestamp();
    await assertFails(setDoc(doc(google(ORG), 'trips', 'new'), d));
  });

  test('an unknown precision value is rejected', async () => {
    await assertFails(
      setDoc(doc(google(ORG), 'trips', 'new'), {
        ...tripFixture({ datePrecision: 'approximate' }),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    );
  });

  test('dateOnly is accepted', async () => {
    await assertSucceeds(
      setDoc(doc(google(ORG), 'trips', 'new'), {
        ...tripFixture({ datePrecision: 'dateOnly' }),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    );
  });
});

/* ------------------------------------------------------------- history --- */

describe('reading history', () => {
  test('an approved member reads the history list, newest first', async () => {
    const snap = await assertSucceeds(historyQuery(google(MEMBER)));
    assert.deepEqual(snap.docs.map((d) => d.id), ['past2026', 'past2025']);
  });

  test('history excludes the current, draft and cancelled trips', async () => {
    const snap = await assertSucceeds(historyQuery(google(MEMBER)));
    const ids = snap.docs.map((d) => d.id);
    for (const excluded of ['current', 'secret', 'scrapped']) {
      assert.equal(ids.includes(excluded), false, `${excluded} must not be history`);
    }
  });

  test('a member opens a historical trip detail', async () => {
    await assertSucceeds(getDoc(doc(google(MEMBER), 'trips', 'past2026')));
  });

  test('a member still reads a cancelled trip by id', async () => {
    // Visible, so still readable — just never presented as history.
    await assertSucceeds(getDoc(doc(google(MEMBER), 'trips', 'scrapped')));
  });

  test('a member reads the attendee snapshots', async () => {
    const snap = await assertSucceeds(
      getDocs(collection(google(MEMBER), 'trips', 'past2026', 'attendees')),
    );
    assert.equal(snap.size, 2);
  });
});

describe('history is closed to everyone else', () => {
  test('a pending user cannot read history', async () => {
    await assertFails(historyQuery(google(PENDING)));
    await assertFails(getDoc(doc(google(PENDING), 'trips', 'past2026')));
  });

  test('a pending user cannot read attendee snapshots', async () => {
    await assertFails(
      getDocs(collection(google(PENDING), 'trips', 'past2026', 'attendees')),
    );
  });

  test('an anonymous account cannot read history', async () => {
    await assertFails(historyQuery(anonymous(MEMBER)));
    await assertFails(getDoc(doc(anonymous(MEMBER), 'trips', 'past2026')));
  });

  test('an unauthenticated visitor cannot read history', async () => {
    await assertFails(historyQuery(guest()));
    await assertFails(getDoc(doc(guest(), 'trips', 'past2026')));
    await assertFails(getDocs(collection(guest(), 'trips', 'past2026', 'attendees')));
  });

  test('a removed member loses history on the very next read', async () => {
    const db = google(MEMBER);
    await assertSucceeds(historyQuery(db));
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'approvedMembers', MEMBER), {}, { merge: false });
      await ctx.firestore().doc(`approvedMembers/${MEMBER}`).delete();
    });
    await assertFails(historyQuery(db));
  });
});

/* --------------------------------------------- attendee snapshot writes -- */

describe('attendee snapshots are server-owned', () => {
  const snapshot = {
    displayName: 'Fake',
    attendance: 'yes',
    source: 'manual',
    createdAt: serverTimestamp(),
  };

  test('a member cannot add themselves to a past trip', async () => {
    await assertFails(
      setDoc(doc(google(MEMBER), 'trips', 'past2026', 'attendees', MEMBER), snapshot),
    );
  });

  test('a member cannot edit an existing snapshot', async () => {
    await assertFails(
      updateDoc(doc(google(MEMBER), 'trips', 'past2026', 'attendees', MEMBER), {
        displayName: 'Rewritten',
      }),
    );
  });

  test('a member cannot delete a snapshot', async () => {
    await assertFails(
      testEnv
        .authenticatedContext(MEMBER, {
          email: 'a@gmail.com',
          email_verified: true,
          firebase: { identities: { 'google.com': ['s'] }, sign_in_provider: 'google.com' },
        })
        .firestore()
        .doc('trips/past2026/attendees/manual_1')
        .delete(),
    );
  });

  test('even an ORGANIZER cannot write a snapshot directly', async () => {
    // History edits go through the callable, which is the audited path.
    await assertFails(
      setDoc(doc(google(ORG), 'trips', 'past2026', 'attendees', 'manual_2'), snapshot),
    );
  });

  test('an organizer cannot delete a snapshot directly', async () => {
    await assertFails(
      google(ORG).doc('trips/past2026/attendees/manual_1').delete(),
    );
  });

  test('the attendee count is server-owned and cannot be hand-edited', async () => {
    await assertFails(
      updateDoc(doc(google(ORG), 'trips', 'past2026'), {
        attendeeCount: 99,
        updatedAt: serverTimestamp(),
        updatedBy: ORG,
      }),
    );
  });
});

/* --------------------------------------------------- ordinary member writes */

describe('ordinary members cannot modify history', () => {
  test('a member cannot edit a historical trip', async () => {
    await assertFails(
      updateDoc(doc(google(MEMBER), 'trips', 'past2026'), {
        memory: 'I was there',
        updatedAt: serverTimestamp(),
        updatedBy: MEMBER,
      }),
    );
  });

  test('a member cannot create a historical trip', async () => {
    await assertFails(
      setDoc(doc(google(MEMBER), 'trips', 'fake_history'), {
        ...tripFixture({}),
        createdAt: serverTimestamp(),
        createdBy: MEMBER,
        updatedAt: serverTimestamp(),
        updatedBy: MEMBER,
      }),
    );
  });

  test('an organizer CAN edit a historical trip', async () => {
    await assertSucceeds(
      updateDoc(doc(google(ORG), 'trips', 'past2026'), {
        memory: 'Dita më e nxehtë e verës',
        updatedAt: serverTimestamp(),
        updatedBy: ORG,
      }),
    );
  });

  test('audit fields stay immutable even for an organizer', async () => {
    await assertFails(
      updateDoc(doc(google(ORG), 'trips', 'past2026'), {
        createdBy: ORG,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        updatedBy: ORG,
      }),
    );
  });
});
