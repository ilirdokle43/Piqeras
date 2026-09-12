#!/usr/bin/env node
/**
 * Retires a superseded account's Firestore documents.
 *
 * Deliberately does NOT touch Firebase Auth. Per the agreed membership policy,
 * removal revokes group membership and never deletes or disables the underlying
 * account — deleting an Auth record is a separate, explicit decision.
 *
 *   node tools/cleanup-account.mjs --uid <uid> --dry-run
 *   node tools/cleanup-account.mjs --uid <uid>
 *
 * Refuses to run when it would damage something:
 *   - the account still owns a display-name claim (the name would be orphaned)
 *   - it is the last remaining organizer
 *   - it has responses on an ACTIVE trip (historical ones are fine and kept)
 */

import { getDocument, deleteDocument, listDocuments } from './admin-rest.mjs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { isTripActive } = require('../functions/lib/domain.js');

function arg(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? fallback : (process.argv[i + 1] ?? fallback);
}

const UID = arg('--uid');
const dryRun = process.argv.includes('--dry-run');
const force = process.argv.includes('--force');

if (!UID) {
  console.error('Usage: node tools/cleanup-account.mjs --uid <uid> [--dry-run]');
  process.exit(1);
}

async function main() {
  const [user, member, organizer, pending, priv, claims, organizers, trips] =
    await Promise.all([
      getDocument(`users/${UID}`),
      getDocument(`approvedMembers/${UID}`),
      getDocument(`organizers/${UID}`),
      getDocument(`pendingMembers/${UID}`),
      getDocument(`privateProfiles/${UID}`),
      listDocuments('displayNames'),
      listDocuments('organizers'),
      listDocuments('trips'),
    ]);

  const blockers = [];

  // 1. Never orphan a display name.
  const owned = claims.filter((c) => c.uid === UID);
  if (owned.length > 0) {
    blockers.push(
      `still owns display-name claim(s): ${owned.map((c) => `"${c.id}"`).join(', ')} — transfer or release them first`,
    );
  }

  // 2. Never leave the group without an organizer.
  if (organizer && organizers.length <= 1) {
    blockers.push('this is the last organizer — promote somebody else first');
  }

  // 3. Never silently drop a live vote. Historical responses are kept anyway.
  const activeResponses = [];
  const historicalResponses = [];
  for (const trip of trips) {
    const r = await getDocument(`trips/${trip.id}/responses/${UID}`);
    if (!r) continue;
    (isTripActive(trip.status) ? activeResponses : historicalResponses).push(trip.id);
  }
  if (activeResponses.length > 0) {
    blockers.push(`has responses on active trip(s): ${activeResponses.join(', ')}`);
  }

  const ops = [];
  const push = (path, doc, why) => {
    if (doc) ops.push({ path, why });
  };
  push(`approvedMembers/${UID}`, member, 'revoke group membership');
  push(`organizers/${UID}`, organizer, 'remove organizer record (clears the custom claim via onOrganizerWritten)');
  push(`pendingMembers/${UID}`, pending, 'remove pending request');
  push(`privateProfiles/${UID}`, priv, 'remove the stored email');
  push(`users/${UID}`, user, 'remove the public profile (disappears from the roster)');

  const tokens = await listDocuments(`users/${UID}/tokens`).catch(() => []);
  for (const t of tokens) {
    ops.push({ path: `users/${UID}/tokens/${t.id}`, why: 'stop notifications to this device' });
  }

  console.log(`Cleanup of ${UID}`);
  console.log(dryRun ? '[DRY RUN — nothing will be written]\n' : '[APPLYING]\n');

  if (blockers.length > 0) {
    console.log('  BLOCKED:');
    for (const b of blockers) console.log(`    - ${b}`);
    if (!force) {
      console.log('\n  Refusing to proceed. Resolve the above, or pass --force if you are certain.');
      process.exit(1);
    }
    console.log('\n  --force given; proceeding anyway.\n');
  }

  if (ops.length === 0) {
    console.log('  Nothing to remove — this account has no Firestore documents.');
  }
  for (const [i, op] of ops.entries()) {
    console.log(`  ${i + 1}. DELETE ${op.path}`);
    console.log(`       why: ${op.why}`);
  }

  console.log('\n  Explicitly NOT touched:');
  console.log(`    - the Firebase Auth account ${UID} (kept and enabled)`);
  if (historicalResponses.length > 0) {
    console.log(`    - responses on finished trips: ${historicalResponses.join(', ')} (historical record)`);
  } else {
    console.log('    - no historical responses exist for this account');
  }

  if (dryRun) {
    console.log(`\n  ${ops.length} deletion(s) would be applied.`);
    console.log('  Rollback: recreate them from snapshots/pre-migration.json.');
    return;
  }

  for (const op of ops) {
    await deleteDocument(op.path);
    console.log(`  deleted: ${op.path}`);
  }
  console.log('\n  Cleanup complete.');
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
