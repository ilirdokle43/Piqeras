#!/usr/bin/env node
/**
 * Backfills the fields the Trip History release requires.
 *
 * MUST run BEFORE the new rules are deployed. The member read rule tests
 * `visible`, and every client query constrains it — a trip without the field
 * matches nothing, so the current trip would simply vanish from the home
 * screen until this has run.
 *
 *   node tools/migrate-trip-schema.mjs --dry-run
 *   node tools/migrate-trip-schema.mjs
 *
 * Idempotent: it reads current state and writes only what is missing or wrong.
 */

import { listDocuments, setDocument } from './admin-rest.mjs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { isTripVisible } = require('../functions/lib/domain.js');

const dryRun = process.argv.includes('--dry-run');

async function main() {
  const trips = await listDocuments('trips');
  if (trips.length === 0) {
    console.log('No trips — nothing to migrate.');
    return;
  }

  console.log(dryRun ? '[DRY RUN — nothing will be written]\n' : '[APPLYING]\n');

  const ops = [];
  for (const trip of trips) {
    const desired = {};

    // The invariant: visible === (status !== 'draft').
    const visible = isTripVisible(trip.status);
    if (trip.visible !== visible) desired.visible = visible;

    // Every existing trip was created with a real departure time.
    if (!trip.datePrecision) desired.datePrecision = 'dateTime';

    if (typeof trip.attendeeCount !== 'number') desired.attendeeCount = 0;

    if (Object.keys(desired).length === 0) {
      console.log(`  = ${trip.id} (${trip.status}) already migrated`);
      continue;
    }
    ops.push({ id: trip.id, status: trip.status, desired });
  }

  for (const op of ops) {
    console.log(`  + ${op.id} (${op.status})`);
    for (const [k, v] of Object.entries(op.desired)) {
      console.log(`      ${k} = ${JSON.stringify(v)}`);
    }
  }

  if (dryRun) {
    console.log(`\n  ${ops.length} trip(s) would be updated.`);
    console.log('  Rollback: these are additive fields; removing them restores the old shape.');
    return;
  }

  for (const op of ops) {
    // A partial update: updatedAt/updatedBy are deliberately untouched, so a
    // schema backfill does not masquerade as an organizer edit.
    await setDocument(`trips/${op.id}`, op.desired);
    console.log(`  applied: ${op.id}`);
  }

  console.log('\n  Verifying:\n');
  let ok = true;
  for (const trip of await listDocuments('trips')) {
    const good =
      trip.visible === isTripVisible(trip.status) &&
      typeof trip.datePrecision === 'string' &&
      typeof trip.attendeeCount === 'number';
    console.log(
      `  ${good ? 'PASS' : 'FAIL'}  ${trip.id}: visible=${trip.visible} ` +
        `datePrecision=${trip.datePrecision} attendeeCount=${trip.attendeeCount}`,
    );
    if (!good) ok = false;
  }
  if (!ok) {
    console.error('\n  VERIFICATION FAILED — do not deploy the rules yet.');
    process.exit(1);
  }
  console.log('\n  Migration complete. Safe to deploy indexes, rules and hosting.');
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
