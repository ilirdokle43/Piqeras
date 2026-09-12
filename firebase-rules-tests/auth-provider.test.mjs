/**
 * Rules tests for the Google-authentication and approved-membership model.
 *
 * Three tiers are exercised here:
 *   signed in with Google  → may claim a name, may read own status, nothing else
 *   + approved member      → sees the trip and everyone's responses
 *   + organizer record     → manages the trip and the approval queue
 */

import { test, before, after, beforeEach, describe } from 'node:test';
import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';

let testEnv;

const ORG_UID = 'uid_organizer';
const MEMBER_UID = 'uid_member';
const PENDING_UID = 'uid_pending';

const TRIP_ID = 'trip_2026_09';
const DEPARTURE = Timestamp.fromDate(new Date('2026-09-24T04:00:00.000Z'));

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-piqeras-auth',
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

after(async () => testEnv?.cleanup());

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const now = Timestamp.now();

    for (const [uid, name] of [
      [ORG_UID, 'Ilir'],
      [MEMBER_UID, 'Ana'],
      [PENDING_UID, 'Besi'],
    ]) {
      await setDoc(doc(db, 'users', uid), {
        uid,
        displayName: name,
        displayNameLower: name.toLowerCase(),
        createdAt: now,
        updatedAt: now,
      });
    }

    // Only the organizer and the member are approved. PENDING_UID is not.
    for (const uid of [ORG_UID, MEMBER_UID]) {
      await setDoc(doc(db, 'approvedMembers', uid), {
        uid,
        displayName: uid === ORG_UID ? 'Ilir' : 'Ana',
        approvedAt: now,
        approvedBy: 'bootstrap',
      });
    }

    await setDoc(doc(db, 'organizers', ORG_UID), {
      uid: ORG_UID,
      displayName: 'Ilir',
      grantedAt: now,
      grantedBy: 'bootstrap',
    });

    await setDoc(doc(db, 'pendingMembers', PENDING_UID), {
      uid: PENDING_UID,
      googleName: 'Besi B.',
      emailMasked: 'b•••@gmail.com',
      requestedAt: now,
    });

    await setDoc(doc(db, 'trips', TRIP_ID), {
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
      createdBy: ORG_UID,
      updatedAt: now,
      updatedBy: ORG_UID,
    });

    await setDoc(doc(db, 'trips', TRIP_ID, 'responses', MEMBER_UID), {
      uid: MEMBER_UID,
      displayName: 'Ana',
      attendance: 'yes',
      preferredDeparture: DEPARTURE,
      note: null,
      createdAt: now,
      updatedAt: now,
    });
  });
});

/* ------------------------------------------------------------- contexts -- */

/** A normal Google sign-in. */
function google(uid, email = `${uid}@gmail.com`) {
  return testEnv
    .authenticatedContext(uid, {
      email,
      email_verified: true,
      firebase: {
        identities: { 'google.com': [`sub-${uid}`] },
        sign_in_provider: 'google.com',
      },
    })
    .firestore();
}

/**
 * An account that linked Google to an existing anonymous session. The token
 * still reports sign_in_provider 'anonymous' until the next full sign-in, but
 * identities already contains google.com. This is Ilir's exact state during
 * the migration, and it must be treated as a Google account.
 */
function linkedSession(uid) {
  return testEnv
    .authenticatedContext(uid, {
      email: `${uid}@gmail.com`,
      email_verified: true,
      firebase: {
        identities: { 'google.com': [`sub-${uid}`] },
        sign_in_provider: 'anonymous',
      },
    })
    .firestore();
}

/** A plain anonymous account — what every user had before the migration. */
function anonymous(uid) {
  return testEnv
    .authenticatedContext(uid, {
      firebase: { identities: {}, sign_in_provider: 'anonymous' },
    })
    .firestore();
}

const guest = () => testEnv.unauthenticatedContext().firestore();

const currentTripQuery = (db) =>
  getDocs(
    query(
      collection(db, 'trips'),
      where('visible', '==', true),
      where('isCurrent', '==', true),
      limit(1),
    ),
  );

/* ---------------------------------------------------------------- tests -- */

describe('a verified Google identity is required', () => {
  test('an unauthenticated visitor sees nothing', async () => {
    await assertFails(currentTripQuery(guest()));
    await assertFails(getDocs(collection(guest(), 'users')));
  });

  test('an anonymous account is denied the trip, even if approved', async () => {
    // The membership record exists; the identity is what fails.
    await assertFails(currentTripQuery(anonymous(MEMBER_UID)));
  });

  test('an anonymous account is denied the roster', async () => {
    await assertFails(getDocs(collection(anonymous(MEMBER_UID), 'users')));
  });

  test('an anonymous account cannot vote', async () => {
    await assertFails(
      setDoc(doc(anonymous(MEMBER_UID), 'trips', TRIP_ID, 'responses', MEMBER_UID), {
        uid: MEMBER_UID,
        displayName: 'Ana',
        attendance: 'yes',
        preferredDeparture: DEPARTURE,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    );
  });

  test('an anonymous account cannot even claim a display name', async () => {
    await assertFails(
      setDoc(doc(anonymous('uid_x'), 'displayNames', 'dritan'), {
        uid: 'uid_x',
        claimedAt: serverTimestamp(),
      }),
    );
  });

  test('a Google account that is an approved member sees the trip', async () => {
    await assertSucceeds(currentTripQuery(google(MEMBER_UID)));
  });

  test('a token carrying some other provider is not accepted as Google', async () => {
    const db = testEnv
      .authenticatedContext(MEMBER_UID, {
        email: 'x@example.com',
        email_verified: true,
        firebase: {
          identities: { 'facebook.com': ['sub-fb'] },
          sign_in_provider: 'facebook.com',
        },
      })
      .firestore();
    await assertFails(currentTripQuery(db));
  });

  test('an organizer custom claim alone grants nothing in Firestore', async () => {
    // Firestore never trusts the claim — it reads the server-owned records.
    const db = testEnv
      .authenticatedContext('uid_impostor', {
        organizer: true,
        email: 'impostor@gmail.com',
        email_verified: true,
        firebase: {
          identities: { 'google.com': ['sub-impostor'] },
          sign_in_provider: 'google.com',
        },
      })
      .firestore();
    await assertFails(currentTripQuery(db));
    await assertFails(
      setDoc(doc(db, 'trips', TRIP_ID), { title: 'hacked' }, { merge: true }),
    );
  });
});

describe('an account that linked Google to its anonymous session', () => {
  test('is treated as a Google account immediately, without re-signing in', async () => {
    // If the rules tested sign_in_provider instead of identities, this would
    // fail and Ilir would be locked out the moment he migrated.
    await assertSucceeds(currentTripQuery(linkedSession(MEMBER_UID)));
  });

  test('keeps its organizer powers through the link', async () => {
    // A partial update: createdAt/createdBy are immutable and must not be
    // resent, which is itself enforced by the rules.
    await assertSucceeds(
      updateDoc(doc(linkedSession(ORG_UID), 'trips', TRIP_ID), {
        votingLocked: true,
        updatedAt: serverTimestamp(),
        updatedBy: ORG_UID,
      }),
    );
  });

  test('can still read the approval queue as an organizer', async () => {
    await assertSucceeds(getDocs(collection(linkedSession(ORG_UID), 'pendingMembers')));
  });
});

describe('a pending user sees nothing about the trip', () => {
  test('cannot query the current trip', async () => {
    await assertFails(currentTripQuery(google(PENDING_UID)));
  });

  test('cannot read the trip by id', async () => {
    await assertFails(getDoc(doc(google(PENDING_UID), 'trips', TRIP_ID)));
  });

  test('cannot read anybody responses', async () => {
    await assertFails(
      getDocs(collection(google(PENDING_UID), 'trips', TRIP_ID, 'responses')),
    );
  });

  test('cannot read a single response by id', async () => {
    await assertFails(
      getDoc(doc(google(PENDING_UID), 'trips', TRIP_ID, 'responses', MEMBER_UID)),
    );
  });

  test('cannot enumerate member names', async () => {
    await assertFails(getDocs(collection(google(PENDING_UID), 'users')));
  });

  test('cannot read another member profile by id', async () => {
    await assertFails(getDoc(doc(google(PENDING_UID), 'users', MEMBER_UID)));
  });

  test('cannot see who the organizers are', async () => {
    await assertFails(getDocs(collection(google(PENDING_UID), 'organizers')));
  });

  test('cannot see the approval queue', async () => {
    await assertFails(getDocs(collection(google(PENDING_UID), 'pendingMembers')));
  });

  test('cannot see the member list', async () => {
    await assertFails(getDocs(collection(google(PENDING_UID), 'approvedMembers')));
  });

  test('cannot vote', async () => {
    await assertFails(
      setDoc(doc(google(PENDING_UID), 'trips', TRIP_ID, 'responses', PENDING_UID), {
        uid: PENDING_UID,
        displayName: 'Besi',
        attendance: 'yes',
        preferredDeparture: DEPARTURE,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    );
  });
});

describe('what a pending user CAN do while waiting', () => {
  test('reads their own profile', async () => {
    await assertSucceeds(getDoc(doc(google(PENDING_UID), 'users', PENDING_UID)));
  });

  test('chooses a display name before being approved', async () => {
    // So the organizer approves a real name rather than an opaque account.
    await assertSucceeds(
      setDoc(doc(google('uid_fresh'), 'users', 'uid_fresh'), {
        uid: 'uid_fresh',
        displayName: 'Dritan',
        displayNameLower: 'dritan',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    );
  });

  test('claims their display name before being approved', async () => {
    await assertSucceeds(
      setDoc(doc(google('uid_fresh'), 'displayNames', 'dritan'), {
        uid: 'uid_fresh',
        claimedAt: serverTimestamp(),
      }),
    );
  });

  test('polls their own approval record, which does not exist yet', async () => {
    // This is how the app flips from "waiting" to "approved" in realtime.
    await assertSucceeds(
      getDoc(doc(google(PENDING_UID), 'approvedMembers', PENDING_UID)),
    );
  });

  test('reads their own pending record', async () => {
    await assertSucceeds(
      getDoc(doc(google(PENDING_UID), 'pendingMembers', PENDING_UID)),
    );
  });

  test('cannot read somebody else pending record', async () => {
    await assertFails(getDoc(doc(google(PENDING_UID), 'pendingMembers', ORG_UID)));
  });
});

describe('membership cannot be granted from a client', () => {
  test('a pending user cannot approve themselves', async () => {
    await assertFails(
      setDoc(doc(google(PENDING_UID), 'approvedMembers', PENDING_UID), {
        uid: PENDING_UID,
        displayName: 'Besi',
        approvedAt: serverTimestamp(),
        approvedBy: PENDING_UID,
      }),
    );
  });

  test('a member cannot approve somebody else', async () => {
    await assertFails(
      setDoc(doc(google(MEMBER_UID), 'approvedMembers', PENDING_UID), {
        uid: PENDING_UID,
        displayName: 'Besi',
        approvedAt: serverTimestamp(),
        approvedBy: MEMBER_UID,
      }),
    );
  });

  test('even an organizer cannot approve by writing Firestore directly', async () => {
    // Approval must go through the callable, which is the audited path.
    await assertFails(
      setDoc(doc(google(ORG_UID), 'approvedMembers', PENDING_UID), {
        uid: PENDING_UID,
        displayName: 'Besi',
        approvedAt: serverTimestamp(),
        approvedBy: ORG_UID,
      }),
    );
  });

  test('a member cannot remove their own membership record', async () => {
    await assertFails(deleteDoc(doc(google(MEMBER_UID), 'approvedMembers', MEMBER_UID)));
  });

  test('an organizer cannot delete a membership record directly', async () => {
    await assertFails(deleteDoc(doc(google(ORG_UID), 'approvedMembers', MEMBER_UID)));
  });

  test('nobody can write the pending queue', async () => {
    await assertFails(
      setDoc(doc(google(ORG_UID), 'pendingMembers', 'uid_x'), {
        uid: 'uid_x',
        googleName: 'X',
        emailMasked: 'x•••@gmail.com',
        requestedAt: serverTimestamp(),
      }),
    );
  });
});

describe('revoking membership takes effect immediately', () => {
  test('a removed member loses the trip on the very next read', async () => {
    const db = google(MEMBER_UID);
    await assertSucceeds(currentTripQuery(db));

    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await deleteDoc(doc(ctx.firestore(), 'approvedMembers', MEMBER_UID));
    });

    await assertFails(currentTripQuery(db));
  });

  test('an organizer whose membership is revoked loses organizer powers too', async () => {
    // Organizer powers require BOTH records, so revocation cannot leave a
    // privileged orphan behind.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await deleteDoc(doc(ctx.firestore(), 'approvedMembers', ORG_UID));
    });
    await assertFails(getDocs(collection(google(ORG_UID), 'pendingMembers')));
  });

  test('an organizer record without membership does not grant access', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'organizers', PENDING_UID), {
        uid: PENDING_UID,
        displayName: 'Besi',
        grantedAt: Timestamp.now(),
        grantedBy: 'bootstrap',
      });
    });
    await assertFails(currentTripQuery(google(PENDING_UID)));
  });
});

describe('the verified email stays private', () => {
  test('the owner stores the email from their own token', async () => {
    await assertSucceeds(
      setDoc(doc(google(MEMBER_UID), 'privateProfiles', MEMBER_UID), {
        uid: MEMBER_UID,
        email: `${MEMBER_UID}@gmail.com`,
        updatedAt: serverTimestamp(),
      }),
    );
  });

  test('an email that does not match the token is rejected', async () => {
    await assertFails(
      setDoc(doc(google(MEMBER_UID), 'privateProfiles', MEMBER_UID), {
        uid: MEMBER_UID,
        email: 'someone.else@gmail.com',
        updatedAt: serverTimestamp(),
      }),
    );
  });

  test('an unverified email is rejected', async () => {
    const db = testEnv
      .authenticatedContext(MEMBER_UID, {
        email: 'unverified@gmail.com',
        email_verified: false,
        firebase: {
          identities: { 'google.com': ['sub-u'] },
          sign_in_provider: 'google.com',
        },
      })
      .firestore();
    await assertFails(
      setDoc(doc(db, 'privateProfiles', MEMBER_UID), {
        uid: MEMBER_UID,
        email: 'unverified@gmail.com',
        updatedAt: serverTimestamp(),
      }),
    );
  });

  test('another member cannot read it', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'privateProfiles', MEMBER_UID), {
        uid: MEMBER_UID,
        email: 'ana@gmail.com',
        updatedAt: Timestamp.now(),
      });
    });
    await assertFails(getDoc(doc(google(ORG_UID), 'privateProfiles', MEMBER_UID)));
  });

  test('an organizer cannot read it either', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'privateProfiles', MEMBER_UID), {
        uid: MEMBER_UID,
        email: 'ana@gmail.com',
        updatedAt: Timestamp.now(),
      });
    });
    // Organizers are group members; the requirement is that no group member
    // sees another member's address.
    await assertFails(getDoc(doc(google(ORG_UID), 'privateProfiles', MEMBER_UID)));
  });

  test('it cannot be written into another account', async () => {
    await assertFails(
      setDoc(doc(google(MEMBER_UID), 'privateProfiles', ORG_UID), {
        uid: ORG_UID,
        email: `${MEMBER_UID}@gmail.com`,
        updatedAt: serverTimestamp(),
      }),
    );
  });

  test('the email never leaks into the group-readable profile', async () => {
    await assertFails(
      setDoc(doc(google(MEMBER_UID), 'users', MEMBER_UID), {
        uid: MEMBER_UID,
        displayName: 'Ana',
        displayNameLower: 'ana',
        email: 'ana@gmail.com',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    );
  });
});

describe('identity fields cannot be spoofed', () => {
  test('a member cannot write a profile claiming another uid', async () => {
    await assertFails(
      setDoc(doc(google(MEMBER_UID), 'users', MEMBER_UID), {
        uid: ORG_UID,
        displayName: 'Ana',
        displayNameLower: 'ana',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    );
  });

  test('a member cannot vote in somebody else slot', async () => {
    await assertFails(
      setDoc(doc(google(MEMBER_UID), 'trips', TRIP_ID, 'responses', ORG_UID), {
        uid: ORG_UID,
        displayName: 'Ilir',
        attendance: 'yes',
        preferredDeparture: DEPARTURE,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    );
  });

  test('a member cannot grant themselves the organizer record', async () => {
    await assertFails(
      setDoc(doc(google(MEMBER_UID), 'organizers', MEMBER_UID), {
        uid: MEMBER_UID,
        displayName: 'Ana',
        grantedAt: serverTimestamp(),
        grantedBy: MEMBER_UID,
      }),
    );
  });
});
