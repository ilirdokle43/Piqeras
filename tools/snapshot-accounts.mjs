#!/usr/bin/env node
/**
 * Read-only snapshot of everything tied to one or more accounts.
 *
 * Taken before any migration so there is a known-good state to compare against
 * and to restore from. Writes a timestamped JSON file and touches nothing.
 *
 *   node tools/snapshot-accounts.mjs <uid> [<uid> ...] [--out path]
 */

import { writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { getDocument, listDocuments } from './admin-rest.mjs';

const GCLOUD =
  process.env.GCLOUD_PATH ?? 'C:/Users/Tdshm/google-cloud-sdk/bin/gcloud.cmd';

const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
const outPath =
  outIndex === -1
    ? `snapshot-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
    : args[outIndex + 1];
const uids = args.filter((a, i) => !a.startsWith('--') && i !== outIndex + 1);

if (uids.length === 0) {
  console.error('Usage: node tools/snapshot-accounts.mjs <uid> [<uid> ...]');
  process.exit(1);
}

function accessToken() {
  return execSync(`"${GCLOUD}" auth print-access-token`, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

async function authRecord(uid) {
  const res = await fetch(
    'https://identitytoolkit.googleapis.com/v1/projects/piqeras/accounts:lookup',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken()}`,
        'x-goog-user-project': 'piqeras',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ localId: [uid] }),
    },
  );
  const body = await res.json();
  return body.users?.[0] ?? null;
}

async function main() {
  const trips = await listDocuments('trips');

  const snapshot = {
    takenAt: new Date().toISOString(),
    project: 'piqeras',
    accounts: {},
    shared: {
      displayNames: await listDocuments('displayNames'),
      trips: trips.map((t) => ({ id: t.id, status: t.status, isCurrent: t.isCurrent })),
    },
  };

  for (const uid of uids) {
    const responses = [];
    for (const trip of trips) {
      const r = await getDocument(`trips/${trip.id}/responses/${uid}`);
      if (r) responses.push({ tripId: trip.id, response: r });
    }

    snapshot.accounts[uid] = {
      auth: await authRecord(uid),
      firestore: {
        user: await getDocument(`users/${uid}`),
        approvedMember: await getDocument(`approvedMembers/${uid}`),
        pendingMember: await getDocument(`pendingMembers/${uid}`),
        organizer: await getDocument(`organizers/${uid}`),
        privateProfile: await getDocument(`privateProfiles/${uid}`),
        tokens: await listDocuments(`users/${uid}/tokens`).catch(() => []),
        responses,
      },
    };
  }

  writeFileSync(outPath, JSON.stringify(snapshot, null, 2), 'utf8');
  console.log(`Snapshot written to ${outPath}`);

  for (const [uid, data] of Object.entries(snapshot.accounts)) {
    const providers =
      data.auth?.providerUserInfo?.map((p) => p.providerId) ?? ['anonymous'];
    console.log(`\n  ${uid}`);
    console.log(`    auth      : providers=${providers} claims=${data.auth?.customAttributes ?? '-'}`);
    console.log(`    email     : ${data.auth?.email ?? '-'}`);
    for (const [key, value] of Object.entries(data.firestore)) {
      if (Array.isArray(value)) {
        console.log(`    ${key.padEnd(10)}: ${value.length} item(s)`);
      } else {
        console.log(`    ${key.padEnd(10)}: ${value ? 'present' : '-'}`);
      }
    }
  }
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
