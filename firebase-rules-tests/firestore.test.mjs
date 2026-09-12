/**
 * Firestore Security Rules tests for Piqeras.
 *
 * Runs against the local emulator only:
 *   npm --prefix firebase-rules-tests test
 *
 * The emulator is launched from the repository root (see package.json) because
 * it refuses a rules path outside its own project directory.
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
  doc,
  setDoc,
  getDoc,
  updateDoc,
  deleteDoc,
  collection,
  getDocs,
  serverTimestamp,
  Timestamp,
  writeBatch,
} from 'firebase/firestore';

let testEnv;

const ORG_UID = 'uid_organizer';
const ANA_UID = 'uid_ana';
const BESI_UID = 'uid_besi';

const TRIP_ID = 'trip_2026_09';

/** 24 September 2026, 06:00 Europe/Tirane (= 04:00 UTC, CEST is UTC+2). */
const DEPARTURE = Timestamp.fromDate(new Date('2026-09-24T04:00:00.000Z'));
const DEADLINE_FUTURE = Timestamp.fromDate(new Date('2026-09-20T22:00:00.000Z'));
const DEADLINE_PAST = Timestamp.fromDate(new Date('2020-01-02T00:00:00.000Z'));

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-piqeras',
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

after(async () => {
  await testEnv?.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await seed();
});

/** Everything an unauthenticated fixture needs, written with rules disabled. */
async function seed() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const now = Timestamp.now();

    await setDoc(doc(db, 'organizers', ORG_UID), {
      uid: ORG_UID,
      displayName: 'Ilir',
      grantedAt: now,
      grantedBy: 'bootstrap',
    });

    // Approved group membership. The organizer is a member too — organizer
    // powers require both records.
    for (const uid of [ORG_UID, ANA_UID, BESI_UID]) {
      await setDoc(doc(db, 'approvedMembers', uid), {
        uid,
        displayName: uid === ORG_UID ? 'Ilir' : uid === ANA_UID ? 'Ana' : 'Besi',
        approvedAt: now,
        approvedBy: ORG_UID,
      });
    }

    for (const [uid, name] of [
      [ORG_UID, 'Ilir'],
      [ANA_UID, 'Ana'],
      [BESI_UID, 'Besi'],
    ]) {
      await setDoc(doc(db, 'users', uid), {
        uid,
        displayName: name,
        displayNameLower: name.toLowerCase(),
        createdAt: now,
        updatedAt: now,
      });
      await setDoc(doc(db, 'displayNames', name.toLowerCase()), {
        uid,
        claimedAt: now,
      });
    }

    await setDoc(doc(db, 'trips', TRIP_ID), {
      title: 'Piqeras',
      destination: 'Piqeras, Sarandë',
      description: 'Dalja e vjeshtës',
      status: 'voting',
      proposedDeparture: DEPARTURE,
      finalDeparture: null,
      votingDeadline: DEADLINE_FUTURE,
      votingLocked: false,
      isCurrent: true,
      visible: true,
      datePrecision: 'dateTime',
      responseCounts: { yes: 0, maybe: 0, no: 0 },
      respondedCount: 0,
      createdAt: now,
      createdBy: ORG_UID,
      updatedAt: now,
      updatedBy: ORG_UID,
    });
  });
}

/** Overwrite trip fields with rules disabled, to set up a scenario. */
async function patchTrip(fields) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await updateDoc(doc(ctx.firestore(), 'trips', TRIP_ID), fields);
  });
}

async function seedResponse(uid, fields = {}) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'trips', TRIP_ID, 'responses', uid), {
      uid,
      displayName: uid === ANA_UID ? 'Ana' : 'Besi',
      attendance: 'yes',
      preferredDeparture: DEPARTURE,
      note: null,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      ...fields,
    });
  });
}

/**
 * A context whose ID token carries a verified Google identity, which is what
 * the rules require. `identities` is the claim that matters — see the long
 * comment in firestore.rules and auth-provider.test.mjs for why
 * sign_in_provider is deliberately not used.
 */
function googleContext(uid, email = `${uid}@gmail.com`) {
  return testEnv.authenticatedContext(uid, {
    email,
    email_verified: true,
    firebase: { identities: { 'google.com': [`sub-${uid}`] }, sign_in_provider: 'google.com' },
  });
}

const asGoogle = (uid) => googleContext(uid).firestore();

const asAna = () => asGoogle(ANA_UID);
const asBesi = () => asGoogle(BESI_UID);
const asOrganizer = () => asGoogle(ORG_UID);
const asGuest = () => testEnv.unauthenticatedContext().firestore();

function userDoc(uid, name, extra = {}) {
  return {
    uid,
    displayName: name,
    displayNameLower: name.toLowerCase(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...extra,
  };
}

function tripDoc(extra = {}) {
  return {
    title: 'Piqeras',
    destination: 'Piqeras, Sarandë',
    status: 'voting',
    proposedDeparture: DEPARTURE,
    votingLocked: false,
    isCurrent: true,
    visible: true,
    datePrecision: 'dateTime',
    createdAt: serverTimestamp(),
    createdBy: ORG_UID,
    updatedAt: serverTimestamp(),
    updatedBy: ORG_UID,
    ...extra,
  };
}

function responseDoc(uid, name, extra = {}) {
  return {
    uid,
    displayName: name,
    attendance: 'yes',
    preferredDeparture: DEPARTURE,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...extra,
  };
}

// ---------------------------------------------------------------------------

describe('unauthenticated access', () => {
  test('cannot read trips', async () => {
    await assertFails(getDoc(doc(asGuest(), 'trips', TRIP_ID)));
  });

  test('cannot read the member roster', async () => {
    await assertFails(getDocs(collection(asGuest(), 'users')));
  });

  test('cannot read responses', async () => {
    await assertFails(getDocs(collection(asGuest(), 'trips', TRIP_ID, 'responses')));
  });

  test('cannot write anything', async () => {
    await assertFails(setDoc(doc(asGuest(), 'users', ANA_UID), userDoc(ANA_UID, 'Ana')));
  });
});

describe('users', () => {
  test('a member creates their own document', async () => {
    const uid = 'uid_new';
    const db = asGoogle(uid);
    await assertSucceeds(setDoc(doc(db, 'users', uid), userDoc(uid, 'Dritan')));
  });

  test('a member cannot create somebody else’s document', async () => {
    await assertFails(setDoc(doc(asAna(), 'users', BESI_UID), userDoc(BESI_UID, 'Besi')));
  });

  test('a member cannot spoof the uid field', async () => {
    await assertFails(
      setDoc(doc(asAna(), 'users', ANA_UID), userDoc(ORG_UID, 'Ana')),
    );
  });

  test('displayNameLower must match displayName', async () => {
    await assertFails(
      setDoc(doc(asAna(), 'users', ANA_UID), {
        ...userDoc(ANA_UID, 'Ana'),
        displayNameLower: 'somebodyelse',
      }),
    );
  });

  test('an untrimmed display name is rejected', async () => {
    await assertFails(
      setDoc(doc(asAna(), 'users', ANA_UID), userDoc(ANA_UID, '  Ana  ')),
    );
  });

  test('a one-character display name is rejected', async () => {
    await assertFails(setDoc(doc(asAna(), 'users', ANA_UID), userDoc(ANA_UID, 'A')));
  });

  test('a 25-character display name is rejected', async () => {
    await assertFails(
      setDoc(doc(asAna(), 'users', ANA_UID), userDoc(ANA_UID, 'A'.repeat(25))),
    );
  });

  test('every offered interface language is accepted as a locale', async () => {
    // The picker and this allowlist are edited in different files; a language
    // added to one and not the other fails the very next name save.
    //
    // A fresh uid per language keeps this a create: an update would also have
    // to leave `createdAt` untouched, which is a different rule.
    for (const locale of ['sq', 'en', 'el', 'ro', 'it']) {
      const uid = `uid_locale_${locale}`;
      await assertSucceeds(
        setDoc(doc(asGoogle(uid), 'users', uid), userDoc(uid, `Lang ${locale}`, { locale })),
      );
    }
  });

  test('a locale outside the allowlist is rejected', async () => {
    const uid = 'uid_locale_de';
    await assertFails(
      setDoc(doc(asGoogle(uid), 'users', uid), userDoc(uid, 'Lang de', { locale: 'de' })),
    );
  });

  test('unknown fields are rejected', async () => {
    await assertFails(
      setDoc(doc(asAna(), 'users', ANA_UID), {
        ...userDoc(ANA_UID, 'Ana'),
        organizer: true,
      }),
    );
  });

  test('a member cannot backdate createdAt on update', async () => {
    await assertFails(
      updateDoc(doc(asAna(), 'users', ANA_UID), {
        createdAt: Timestamp.fromDate(new Date('2021-01-01T00:00:00Z')),
        updatedAt: serverTimestamp(),
      }),
    );
  });

  test('a member renames themselves', async () => {
    await assertSucceeds(
      updateDoc(doc(asAna(), 'users', ANA_UID), {
        displayName: 'Anisa',
        displayNameLower: 'anisa',
        updatedAt: serverTimestamp(),
      }),
    );
  });

  test('a member cannot rename somebody else', async () => {
    await assertFails(
      updateDoc(doc(asAna(), 'users', BESI_UID), {
        displayName: 'Hacked',
        displayNameLower: 'hacked',
        updatedAt: serverTimestamp(),
      }),
    );
  });

  test('accounts cannot be deleted from a client', async () => {
    await assertFails(deleteDoc(doc(asAna(), 'users', ANA_UID)));
  });

  test('every signed-in member can read the roster', async () => {
    await assertSucceeds(getDocs(collection(asAna(), 'users')));
  });
});

describe('display name uniqueness', () => {
  test('claiming a free name succeeds', async () => {
    const uid = 'uid_new';
    const db = asGoogle(uid);
    await assertSucceeds(
      setDoc(doc(db, 'displayNames', 'dritan'), { uid, claimedAt: serverTimestamp() }),
    );
  });

  test('claiming a taken name fails, regardless of case', async () => {
    const uid = 'uid_new';
    const db = asGoogle(uid);
    // "Ana" is already claimed as "ana" during seeding.
    await assertFails(
      setDoc(doc(db, 'displayNames', 'ana'), { uid, claimedAt: serverTimestamp() }),
    );
  });

  test('a claim cannot be stolen by overwriting it', async () => {
    await assertFails(
      updateDoc(doc(asBesi(), 'displayNames', 'ana'), { uid: BESI_UID }),
    );
  });

  test('a member cannot release somebody else’s claim', async () => {
    await assertFails(deleteDoc(doc(asBesi(), 'displayNames', 'ana')));
  });

  test('a member releases their own claim', async () => {
    await assertSucceeds(deleteDoc(doc(asAna(), 'displayNames', 'ana')));
  });

  test('a claim cannot be filed under a mixed-case id', async () => {
    const uid = 'uid_new';
    const db = asGoogle(uid);
    await assertFails(
      setDoc(doc(db, 'displayNames', 'Dritan'), { uid, claimedAt: serverTimestamp() }),
    );
  });

  test('a rename batch is atomic: colliding new name leaves the old one intact', async () => {
    const db = asBesi();
    const batch = writeBatch(db);
    batch.set(doc(db, 'displayNames', 'ana'), { uid: BESI_UID, claimedAt: serverTimestamp() });
    batch.delete(doc(db, 'displayNames', 'besi'));
    batch.update(doc(db, 'users', BESI_UID), {
      displayName: 'Ana',
      displayNameLower: 'ana',
      updatedAt: serverTimestamp(),
    });
    await assertFails(batch.commit());

    // The old claim must still belong to Besi.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const snap = await getDoc(doc(ctx.firestore(), 'displayNames', 'besi'));
      assert.equal(snap.exists(), true);
      assert.equal(snap.data().uid, BESI_UID);
    });
  });

  test('a rename batch to a free name succeeds end to end', async () => {
    const db = asBesi();
    const batch = writeBatch(db);
    batch.set(doc(db, 'displayNames', 'bes'), { uid: BESI_UID, claimedAt: serverTimestamp() });
    batch.delete(doc(db, 'displayNames', 'besi'));
    batch.update(doc(db, 'users', BESI_UID), {
      displayName: 'Bes',
      displayNameLower: 'bes',
      updatedAt: serverTimestamp(),
    });
    await assertSucceeds(batch.commit());
  });
});

describe('organizer roles', () => {
  test('a member can read who the organizers are', async () => {
    await assertSucceeds(getDoc(doc(asAna(), 'organizers', ORG_UID)));
  });

  test('a member cannot make themselves an organizer', async () => {
    await assertFails(
      setDoc(doc(asAna(), 'organizers', ANA_UID), {
        uid: ANA_UID,
        displayName: 'Ana',
        grantedAt: serverTimestamp(),
        grantedBy: ANA_UID,
      }),
    );
  });

  test('an organizer cannot grant the role by writing Firestore directly', async () => {
    // Grants must go through the callable function / Admin SDK, never a client
    // write — otherwise a compromised organizer session could mint roles.
    await assertFails(
      setDoc(doc(asOrganizer(), 'organizers', ANA_UID), {
        uid: ANA_UID,
        displayName: 'Ana',
        grantedAt: serverTimestamp(),
        grantedBy: ORG_UID,
      }),
    );
  });

  test('an organizer cannot revoke a role by deleting the document', async () => {
    await assertFails(deleteDoc(doc(asOrganizer(), 'organizers', ORG_UID)));
  });
});

describe('trips — reading', () => {
  test('a member reads the active trip', async () => {
    await assertSucceeds(getDoc(doc(asAna(), 'trips', TRIP_ID)));
  });

  test('a member cannot read a draft trip', async () => {
    await patchTrip({ status: 'draft', isCurrent: false, visible: false });
    await assertFails(getDoc(doc(asAna(), 'trips', TRIP_ID)));
  });

  test('an organizer can read a draft trip', async () => {
    await patchTrip({ status: 'draft', isCurrent: false, visible: false });
    await assertSucceeds(getDoc(doc(asOrganizer(), 'trips', TRIP_ID)));
  });

  test('a member CAN read a past trip — this is Historiku', async () => {
    // Behaviour change, deliberate: members used to be able to read only the
    // current trip. Trip history requires reading finished ones, and the read
    // gate is now `visible` rather than `isCurrent`.
    await patchTrip({ status: 'archived', isCurrent: false, visible: true });
    await assertSucceeds(getDoc(doc(asAna(), 'trips', TRIP_ID)));
  });

  test('an organizer reads archived history', async () => {
    await patchTrip({ status: 'archived', isCurrent: false, visible: true });
    await assertSucceeds(getDoc(doc(asOrganizer(), 'trips', TRIP_ID)));
  });

  test('a member still reads the current trip once it is confirmed', async () => {
    await patchTrip({ status: 'confirmed', finalDeparture: DEPARTURE });
    await assertSucceeds(getDoc(doc(asAna(), 'trips', TRIP_ID)));
  });
});

describe('trips — writing', () => {
  test('a member cannot create a trip', async () => {
    await assertFails(setDoc(doc(asAna(), 'trips', 'trip_new'), tripDoc({ createdBy: ANA_UID, updatedBy: ANA_UID })));
  });

  test('an organizer creates a trip', async () => {
    await assertSucceeds(setDoc(doc(asOrganizer(), 'trips', 'trip_new'), tripDoc()));
  });

  test('an organizer cannot forge createdBy', async () => {
    await assertFails(
      setDoc(doc(asOrganizer(), 'trips', 'trip_new'), tripDoc({ createdBy: ANA_UID })),
    );
  });

  test('an organizer cannot forge updatedBy', async () => {
    await assertFails(
      setDoc(doc(asOrganizer(), 'trips', 'trip_new'), tripDoc({ updatedBy: ANA_UID })),
    );
  });

  test('an unknown status is rejected', async () => {
    await assertFails(
      setDoc(doc(asOrganizer(), 'trips', 'trip_new'), tripDoc({ status: 'party' })),
    );
  });

  test('a departure in the year 1970 is rejected', async () => {
    await assertFails(
      setDoc(
        doc(asOrganizer(), 'trips', 'trip_new'),
        tripDoc({ proposedDeparture: Timestamp.fromDate(new Date('1970-01-01T00:00:00Z')) }),
      ),
    );
  });

  test('a departure in the year 3000 is rejected', async () => {
    await assertFails(
      setDoc(
        doc(asOrganizer(), 'trips', 'trip_new'),
        tripDoc({ proposedDeparture: Timestamp.fromDate(new Date('3000-01-01T00:00:00Z')) }),
      ),
    );
  });

  test('a departure sent as a string is rejected', async () => {
    await assertFails(
      setDoc(doc(asOrganizer(), 'trips', 'trip_new'), tripDoc({ proposedDeparture: '2026-09-24' })),
    );
  });

  test('status confirmed without a final departure is rejected', async () => {
    await assertFails(
      setDoc(doc(asOrganizer(), 'trips', 'trip_new'), tripDoc({ status: 'confirmed' })),
    );
  });

  test('status confirmed with a final departure is accepted', async () => {
    await assertSucceeds(
      setDoc(
        doc(asOrganizer(), 'trips', 'trip_new'),
        tripDoc({ status: 'confirmed', finalDeparture: DEPARTURE }),
      ),
    );
  });

  test('a draft trip cannot be marked current', async () => {
    // This is what keeps drafts private: the member read rule is driven by
    // isCurrent, so a current draft would be visible to everyone.
    await assertFails(
      setDoc(
        doc(asOrganizer(), 'trips', 'trip_new'),
        tripDoc({ status: 'draft', isCurrent: true, visible: false }),
      ),
    );
  });

  test('a draft trip that is not current is accepted', async () => {
    await assertSucceeds(
      setDoc(
        doc(asOrganizer(), 'trips', 'trip_new'),
        tripDoc({ status: 'draft', isCurrent: false, visible: false }),
      ),
    );
  });

  test('a client cannot seed non-zero response counters', async () => {
    await assertFails(
      setDoc(
        doc(asOrganizer(), 'trips', 'trip_new'),
        tripDoc({ responseCounts: { yes: 99, maybe: 0, no: 0 } }),
      ),
    );
  });

  test('an organizer cannot hand-edit the response counters', async () => {
    await assertFails(
      updateDoc(doc(asOrganizer(), 'trips', TRIP_ID), {
        responseCounts: { yes: 99, maybe: 0, no: 0 },
        updatedAt: serverTimestamp(),
        updatedBy: ORG_UID,
      }),
    );
  });

  test('an organizer confirms the final departure', async () => {
    await assertSucceeds(
      updateDoc(doc(asOrganizer(), 'trips', TRIP_ID), {
        status: 'confirmed',
        finalDeparture: DEPARTURE,
        votingLocked: true,
        updatedAt: serverTimestamp(),
        updatedBy: ORG_UID,
      }),
    );
  });

  test('a member cannot lock voting', async () => {
    await assertFails(
      updateDoc(doc(asAna(), 'trips', TRIP_ID), {
        votingLocked: true,
        updatedAt: serverTimestamp(),
        updatedBy: ANA_UID,
      }),
    );
  });

  test('createdAt cannot be rewritten', async () => {
    await assertFails(
      updateDoc(doc(asOrganizer(), 'trips', TRIP_ID), {
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        updatedBy: ORG_UID,
      }),
    );
  });

  test('trips cannot be deleted, even by an organizer', async () => {
    await assertFails(deleteDoc(doc(asOrganizer(), 'trips', TRIP_ID)));
  });

  test('an organizer archives a trip instead', async () => {
    await assertSucceeds(
      updateDoc(doc(asOrganizer(), 'trips', TRIP_ID), {
        status: 'archived',
        isCurrent: false,
        updatedAt: serverTimestamp(),
        updatedBy: ORG_UID,
      }),
    );
  });
});

describe('responses', () => {
  test('a member creates their own response', async () => {
    await assertSucceeds(
      setDoc(doc(asAna(), 'trips', TRIP_ID, 'responses', ANA_UID), responseDoc(ANA_UID, 'Ana')),
    );
  });

  test('a member cannot write into another member’s response slot', async () => {
    await assertFails(
      setDoc(doc(asAna(), 'trips', TRIP_ID, 'responses', BESI_UID), responseDoc(BESI_UID, 'Besi')),
    );
  });

  test('a member cannot spoof the uid inside their own response', async () => {
    await assertFails(
      setDoc(
        doc(asAna(), 'trips', TRIP_ID, 'responses', ANA_UID),
        responseDoc(BESI_UID, 'Besi'),
      ),
    );
  });

  test('editing replaces the single response rather than adding one', async () => {
    const ref = doc(asAna(), 'trips', TRIP_ID, 'responses', ANA_UID);
    await assertSucceeds(setDoc(ref, responseDoc(ANA_UID, 'Ana')));
    await assertSucceeds(
      updateDoc(ref, { attendance: 'maybe', updatedAt: serverTimestamp() }),
    );
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const snap = await getDocs(collection(ctx.firestore(), 'trips', TRIP_ID, 'responses'));
      assert.equal(snap.size, 1, 'exactly one response document per member');
      assert.equal(snap.docs[0].id, ANA_UID);
    });
  });

  test('an unknown attendance value is rejected', async () => {
    await assertFails(
      setDoc(
        doc(asAna(), 'trips', TRIP_ID, 'responses', ANA_UID),
        responseDoc(ANA_UID, 'Ana', { attendance: 'ndoshta' }),
      ),
    );
  });

  test('"yes" without a preferred departure is rejected', async () => {
    const d = responseDoc(ANA_UID, 'Ana');
    delete d.preferredDeparture;
    await assertFails(setDoc(doc(asAna(), 'trips', TRIP_ID, 'responses', ANA_UID), d));
  });

  test('"maybe" without a preferred departure is rejected', async () => {
    const d = responseDoc(ANA_UID, 'Ana', { attendance: 'maybe' });
    delete d.preferredDeparture;
    await assertFails(setDoc(doc(asAna(), 'trips', TRIP_ID, 'responses', ANA_UID), d));
  });

  test('"no" without a preferred departure is accepted', async () => {
    const d = responseDoc(ANA_UID, 'Ana', { attendance: 'no' });
    delete d.preferredDeparture;
    await assertSucceeds(setDoc(doc(asAna(), 'trips', TRIP_ID, 'responses', ANA_UID), d));
  });

  test('"no" with a null preferred departure is accepted', async () => {
    await assertSucceeds(
      setDoc(
        doc(asAna(), 'trips', TRIP_ID, 'responses', ANA_UID),
        responseDoc(ANA_UID, 'Ana', { attendance: 'no', preferredDeparture: null }),
      ),
    );
  });

  test('"no" carrying a preferred departure is rejected', async () => {
    await assertFails(
      setDoc(
        doc(asAna(), 'trips', TRIP_ID, 'responses', ANA_UID),
        responseDoc(ANA_UID, 'Ana', { attendance: 'no' }),
      ),
    );
  });

  test('a note longer than 140 characters is rejected', async () => {
    await assertFails(
      setDoc(
        doc(asAna(), 'trips', TRIP_ID, 'responses', ANA_UID),
        responseDoc(ANA_UID, 'Ana', { note: 'x'.repeat(141) }),
      ),
    );
  });

  test('a 140-character note is accepted', async () => {
    await assertSucceeds(
      setDoc(
        doc(asAna(), 'trips', TRIP_ID, 'responses', ANA_UID),
        responseDoc(ANA_UID, 'Ana', { note: 'x'.repeat(140) }),
      ),
    );
  });

  test('a preferred departure in 1970 is rejected', async () => {
    await assertFails(
      setDoc(
        doc(asAna(), 'trips', TRIP_ID, 'responses', ANA_UID),
        responseDoc(ANA_UID, 'Ana', {
          preferredDeparture: Timestamp.fromDate(new Date('1970-06-01T00:00:00Z')),
        }),
      ),
    );
  });

  test('unknown fields in a response are rejected', async () => {
    await assertFails(
      setDoc(
        doc(asAna(), 'trips', TRIP_ID, 'responses', ANA_UID),
        responseDoc(ANA_UID, 'Ana', { weight: 10 }),
      ),
    );
  });

  test('every member can read every response', async () => {
    await seedResponse(ANA_UID);
    await assertSucceeds(getDocs(collection(asBesi(), 'trips', TRIP_ID, 'responses')));
  });
});

describe('voting window', () => {
  test('voting is closed once the organizer locks it', async () => {
    await patchTrip({ votingLocked: true });
    await assertFails(
      setDoc(doc(asAna(), 'trips', TRIP_ID, 'responses', ANA_UID), responseDoc(ANA_UID, 'Ana')),
    );
  });

  test('an existing response cannot be edited once locked', async () => {
    await seedResponse(ANA_UID);
    await patchTrip({ votingLocked: true });
    await assertFails(
      updateDoc(doc(asAna(), 'trips', TRIP_ID, 'responses', ANA_UID), {
        attendance: 'no',
        preferredDeparture: null,
        updatedAt: serverTimestamp(),
      }),
    );
  });

  test('voting is closed after the deadline passes', async () => {
    await patchTrip({ votingDeadline: DEADLINE_PAST });
    await assertFails(
      setDoc(doc(asAna(), 'trips', TRIP_ID, 'responses', ANA_UID), responseDoc(ANA_UID, 'Ana')),
    );
  });

  test('voting is open when the deadline is in the future', async () => {
    await patchTrip({ votingDeadline: DEADLINE_FUTURE });
    await assertSucceeds(
      setDoc(doc(asAna(), 'trips', TRIP_ID, 'responses', ANA_UID), responseDoc(ANA_UID, 'Ana')),
    );
  });

  test('voting is open when no deadline is set', async () => {
    await patchTrip({ votingDeadline: null });
    await assertSucceeds(
      setDoc(doc(asAna(), 'trips', TRIP_ID, 'responses', ANA_UID), responseDoc(ANA_UID, 'Ana')),
    );
  });

  test('a confirmed trip still accepts attendance changes until locked', async () => {
    await patchTrip({ status: 'confirmed', finalDeparture: DEPARTURE });
    await assertSucceeds(
      setDoc(doc(asAna(), 'trips', TRIP_ID, 'responses', ANA_UID), responseDoc(ANA_UID, 'Ana')),
    );
  });

  test('a cancelled trip accepts no responses', async () => {
    await patchTrip({ status: 'cancelled' });
    await assertFails(
      setDoc(doc(asAna(), 'trips', TRIP_ID, 'responses', ANA_UID), responseDoc(ANA_UID, 'Ana')),
    );
  });

  test('a completed trip accepts no responses', async () => {
    await patchTrip({ status: 'completed' });
    await assertFails(
      setDoc(doc(asAna(), 'trips', TRIP_ID, 'responses', ANA_UID), responseDoc(ANA_UID, 'Ana')),
    );
  });
});

describe('removing responses', () => {
  test('a member withdraws their own response', async () => {
    await seedResponse(ANA_UID);
    await assertSucceeds(deleteDoc(doc(asAna(), 'trips', TRIP_ID, 'responses', ANA_UID)));
  });

  test('a member cannot delete another member’s response', async () => {
    await seedResponse(ANA_UID);
    await assertFails(deleteDoc(doc(asBesi(), 'trips', TRIP_ID, 'responses', ANA_UID)));
  });

  test('an organizer removes an invalid response', async () => {
    await seedResponse(ANA_UID);
    await assertSucceeds(deleteDoc(doc(asOrganizer(), 'trips', TRIP_ID, 'responses', ANA_UID)));
  });

  test('an organizer can remove a response even after locking', async () => {
    await seedResponse(ANA_UID);
    await patchTrip({ votingLocked: true });
    await assertSucceeds(deleteDoc(doc(asOrganizer(), 'trips', TRIP_ID, 'responses', ANA_UID)));
  });
});

describe('push tokens', () => {
  test('a member registers their own token', async () => {
    await assertSucceeds(
      setDoc(doc(asAna(), 'users', ANA_UID, 'tokens', 'tok_1'), {
        token: 'tok_1',
        platform: 'web',
        createdAt: serverTimestamp(),
        lastSeenAt: serverTimestamp(),
      }),
    );
  });

  test('the document id must equal the token', async () => {
    await assertFails(
      setDoc(doc(asAna(), 'users', ANA_UID, 'tokens', 'tok_1'), {
        token: 'tok_other',
        platform: 'web',
        createdAt: serverTimestamp(),
        lastSeenAt: serverTimestamp(),
      }),
    );
  });

  test('a member cannot write a token into another account', async () => {
    await assertFails(
      setDoc(doc(asAna(), 'users', BESI_UID, 'tokens', 'tok_1'), {
        token: 'tok_1',
        platform: 'web',
        createdAt: serverTimestamp(),
        lastSeenAt: serverTimestamp(),
      }),
    );
  });

  test('a member cannot read another account’s tokens', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', BESI_UID, 'tokens', 'tok_b'), {
        token: 'tok_b',
        platform: 'android',
        createdAt: Timestamp.now(),
        lastSeenAt: Timestamp.now(),
      });
    });
    await assertFails(getDocs(collection(asAna(), 'users', BESI_UID, 'tokens')));
  });
});

describe('notification ledger', () => {
  test('is invisible to members', async () => {
    await assertFails(getDoc(doc(asAna(), 'notificationEvents', 'trip_created:x')));
  });

  test('is invisible to organizers', async () => {
    await assertFails(getDoc(doc(asOrganizer(), 'notificationEvents', 'trip_created:x')));
  });

  test('cannot be written to suppress a real notification', async () => {
    await assertFails(
      setDoc(doc(asOrganizer(), 'notificationEvents', 'trip_created:x'), {
        type: 'trip_created',
        tripId: 'x',
        createdAt: serverTimestamp(),
        status: 'sent',
      }),
    );
  });
});

describe('collections outside the schema', () => {
  test('an arbitrary collection is closed', async () => {
    await assertFails(setDoc(doc(asAna(), 'anything', 'x'), { a: 1 }));
  });
});
