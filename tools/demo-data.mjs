#!/usr/bin/env node
/**
 * Adds or removes a handful of fake members and responses, for looking at the
 * group and organizer screens with realistic content.
 *
 *   node tools/demo-data.mjs --add
 *   node tools/demo-data.mjs --remove
 *
 * Every document it creates carries `demo-` in its id, and `--remove` deletes
 * exactly those, so it can never touch a real member's data.
 */

import {
  createDocument,
  deleteDocument,
  listDocuments,
  setDocument,
} from './admin-rest.mjs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { fromDateTimeInputs, formatFullSq } = require('../functions/lib/domain.js');

const PREFIX = 'demo-';

const PEOPLE = [
  { id: 'demo-ana', name: 'Ana', attendance: 'yes', at: '2026-09-24T06:00', note: null },
  { id: 'demo-besi', name: 'Besi', attendance: 'yes', at: '2026-09-24T06:00', note: 'Kam 3 vende të lira' },
  { id: 'demo-eri', name: 'Eri', attendance: 'yes', at: '2026-09-24T09:30', note: 'Nisem pas pune' },
  { id: 'demo-drita', name: 'Drita', attendance: 'maybe', at: '2026-09-24T09:30', note: null },
  { id: 'demo-gent', name: 'Gent', attendance: 'no', at: null, note: 'Jam jashtë atë javë' },
  { id: 'demo-luli', name: 'Luli', attendance: null, at: null, note: null }, // never responds
];

async function currentTripId() {
  const trips = await listDocuments('trips');
  const current = trips.find((trip) => trip.isCurrent);
  if (!current) {
    console.error('No current trip. Run tools/seed-trip.mjs first.');
    process.exit(1);
  }
  return current.id;
}

async function add() {
  const tripId = await currentTripId();
  const now = new Date();

  for (const person of PEOPLE) {
    await setDocument(`users/${person.id}`, {
      uid: person.id,
      displayName: person.name,
      displayNameLower: person.name.toLowerCase(),
      createdAt: now,
      updatedAt: now,
    });
    await setDocument(`displayNames/${person.name.toLowerCase()}`, {
      uid: person.id,
      claimedAt: now,
    });

    if (!person.attendance) {
      console.log(`${person.name}: member, no response`);
      continue;
    }

    const preferred = person.at ? fromDateTimeInputs(...person.at.split('T')) : null;
    await setDocument(`trips/${tripId}/responses/${person.id}`, {
      uid: person.id,
      displayName: person.name,
      attendance: person.attendance,
      preferredDeparture: preferred,
      note: person.note,
      createdAt: now,
      updatedAt: now,
    });
    console.log(
      `${person.name}: ${person.attendance}${preferred ? ` @ ${formatFullSq(preferred)}` : ''}`,
    );
  }
  console.log('\nDemo data added. Remove it again with --remove.');
}

async function remove() {
  const tripId = await currentTripId();
  const users = await listDocuments('users');
  const names = await listDocuments('displayNames');
  const responses = await listDocuments(`trips/${tripId}/responses`);

  let removed = 0;
  for (const response of responses) {
    if (response.id.startsWith(PREFIX)) {
      await deleteDocument(`trips/${tripId}/responses/${response.id}`);
      removed += 1;
    }
  }
  for (const user of users) {
    if (user.id.startsWith(PREFIX)) {
      await deleteDocument(`users/${user.id}`);
      removed += 1;
    }
  }
  for (const claim of names) {
    if (String(claim.uid ?? '').startsWith(PREFIX)) {
      await deleteDocument(`displayNames/${claim.id}`);
      removed += 1;
    }
  }
  console.log(`Removed ${removed} demo documents.`);
}

const mode = process.argv.includes('--remove')
  ? remove
  : process.argv.includes('--add')
    ? add
    : null;

if (!mode) {
  console.log('Usage: node tools/demo-data.mjs --add | --remove');
  process.exit(1);
}

mode().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});

// Unused, but keeps the import list honest if the script grows.
void createDocument;
