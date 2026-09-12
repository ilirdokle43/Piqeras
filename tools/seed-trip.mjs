#!/usr/bin/env node
/**
 * Creates the first trip, so the app has something to show before an organizer
 * exists. Afterwards, trips are created from the organizer dashboard.
 *
 *   node tools/seed-trip.mjs
 *   node tools/seed-trip.mjs --departure 2026-09-24T06:00 --deadline 2026-09-17T20:00
 *   node tools/seed-trip.mjs --title "Piqeras" --destination "Piqeras, Sarandë"
 *
 * Times on the command line are Europe/Tirane wall-clock and are converted to
 * UTC instants here, using the same conversion the clients use.
 */

import { createDocument, listDocuments, setDocument } from './admin-rest.mjs';
// The compiled shared domain module — same conversion and formatting the
// clients use, so a seeded departure can never disagree with a displayed one.
// Requires `npm --prefix functions run build` to have run at least once.
// tsc emits CommonJS with an __esModule marker, which makes the ESM default
// import ambiguous. createRequire sidesteps the interop entirely.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { fromDateTimeInputs, formatFullSq } = require('../functions/lib/domain.js');

function arg(flag, fallback = null) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
}

function parseLocal(value, label) {
  const [date, time] = String(value).split('T');
  const instant = fromDateTimeInputs(date ?? '', time ?? '');
  if (!instant) {
    console.error(`Could not read ${label} "${value}". Use YYYY-MM-DDTHH:mm.`);
    process.exit(1);
  }
  return instant;
}

const title = arg('--title', 'Piqeras');
const destination = arg('--destination', 'Piqeras, Sarandë');
const description = arg('--description', '');
const departure = parseLocal(arg('--departure', '2026-09-24T06:00'), 'departure');
const deadlineRaw = arg('--deadline', '2026-09-17T20:00');
const deadline = deadlineRaw === 'none' ? null : parseLocal(deadlineRaw, 'deadline');
const id = arg('--id', `trip-${departure.toISOString().slice(0, 10)}`);

async function main() {
  const existing = await listDocuments('trips');

  // Only one trip may be current at a time.
  for (const trip of existing) {
    if (trip.isCurrent && trip.id !== id) {
      await setDocument(`trips/${trip.id}`, {
        isCurrent: false,
        updatedAt: new Date(),
        updatedBy: 'bootstrap',
      });
      console.log(`cleared isCurrent on ${trip.id}`);
    }
  }

  if (existing.some((trip) => trip.id === id)) {
    console.error(`Trip "${id}" already exists. Edit it from the dashboard, or pass --id.`);
    process.exit(1);
  }

  await createDocument('trips', id, {
    title,
    destination,
    description: description || null,
    status: 'voting',
    proposedDeparture: departure,
    finalDeparture: null,
    votingDeadline: deadline,
    votingLocked: false,
    isCurrent: true,
    backgroundImagePath: null,
    backgroundImageUrl: null,
    backgroundCredit: null,
    responseCounts: { yes: 0, maybe: 0, no: 0 },
    respondedCount: 0,
    createdAt: new Date(),
    createdBy: 'bootstrap',
    updatedAt: new Date(),
    updatedBy: 'bootstrap',
  });

  console.log(`Created trip "${id}"`);
  console.log(`  ${title} — ${destination}`);
  console.log(`  Departure: ${formatFullSq(departure)}  (${departure.toISOString()})`);
  console.log(
    deadline
      ? `  Voting closes: ${formatFullSq(deadline)}`
      : '  Voting has no deadline',
  );
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
