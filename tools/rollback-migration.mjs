#!/usr/bin/env node
/**
 * Undoes tools/migrate-account.mjs, restoring state from the pre-migration
 * snapshot.
 *
 * Exists before the migration runs, not after, because the moment you need a
 * rollback is the worst moment to be writing one.
 *
 *   node tools/rollback-migration.mjs --snapshot snapshots/pre-migration.json \
 *        --from <sourceUid> --to <targetUid> --name Ilir --dry-run
 *
 * The source account is never modified by the migration, so rolling back only
 * touches the target and the one shared display-name claim.
 */

import { readFileSync } from 'node:fs';
import { getDocument, setDocument, deleteDocument } from './admin-rest.mjs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { normalizeDisplayName } = require('../functions/lib/domain.js');

function arg(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? fallback : (process.argv[i + 1] ?? fallback);
}

const snapshotPath = arg('--snapshot', 'snapshots/pre-migration.json');
const FROM = arg('--from');
const TO = arg('--to');
const DESIRED_NAME = arg('--name', 'Ilir');
const dryRun = process.argv.includes('--dry-run');

if (!FROM || !TO) {
  console.error('Usage: node tools/rollback-migration.mjs --from <uid> --to <uid> [--name Ilir] [--dry-run]');
  process.exit(1);
}

const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'));
const before = snapshot.accounts?.[TO];
if (!before) {
  console.error(`Snapshot ${snapshotPath} has no record for ${TO}.`);
  process.exit(1);
}

const asDate = (v) => (v ? new Date(v) : new Date());

async function main() {
  const { displayNameLower } = normalizeDisplayName(DESIRED_NAME);
  const ops = [];

  // 1. Hand the shared claim back to the source.
  const claim = await getDocument(`displayNames/${displayNameLower}`);
  if (claim && claim.uid !== FROM) {
    const original = snapshot.shared.displayNames.find((d) => d.id === displayNameLower);
    ops.push({
      op: 'set',
      path: `displayNames/${displayNameLower}`,
      data: { uid: FROM, claimedAt: asDate(original?.claimedAt) },
      why: `return "${displayNameLower}" to ${FROM}`,
    });
  }

  // 2. Restore the target's original profile name.
  const user = before.firestore.user;
  if (user) {
    const current = await getDocument(`users/${TO}`);
    if (current && current.displayName !== user.displayName) {
      ops.push({
        op: 'set',
        path: `users/${TO}`,
        data: {
          uid: TO,
          displayName: user.displayName,
          displayNameLower: user.displayNameLower,
          createdAt: asDate(user.createdAt),
          updatedAt: new Date(),
          locale: user.locale ?? 'sq',
          timeZone: user.timeZone ?? '',
          platform: user.platform ?? 'web',
        },
        why: `restore profile name "${user.displayName}"`,
      });
    }

    // 3. Recreate the target's original claim.
    const originalLower = user.displayNameLower;
    if (originalLower && originalLower !== displayNameLower) {
      const existing = await getDocument(`displayNames/${originalLower}`);
      if (!existing) {
        const snap = snapshot.shared.displayNames.find((d) => d.id === originalLower);
        ops.push({
          op: 'set',
          path: `displayNames/${originalLower}`,
          data: { uid: TO, claimedAt: asDate(snap?.claimedAt) },
          why: `recreate "${originalLower}"`,
        });
      }
    }
  }

  // 4/5. Remove what the migration granted, unless the snapshot had it.
  for (const [collection, key] of [
    ['approvedMembers', 'approvedMember'],
    ['organizers', 'organizer'],
  ]) {
    const had = before.firestore[key];
    const now = await getDocument(`${collection}/${TO}`);
    if (now && !had) {
      ops.push({
        op: 'delete',
        path: `${collection}/${TO}`,
        why: `revoke ${collection} granted by the migration`,
      });
    }
  }

  // 6. Restore the pending record.
  const pending = before.firestore.pendingMember;
  if (pending && !(await getDocument(`pendingMembers/${TO}`))) {
    ops.push({
      op: 'set',
      path: `pendingMembers/${TO}`,
      data: {
        uid: TO,
        googleName: pending.googleName ?? '',
        emailMasked: pending.emailMasked ?? '',
        requestedAt: asDate(pending.requestedAt),
      },
      why: 'restore pending status',
    });
  }

  console.log(`Rollback ${TO} -> pre-migration state (source ${FROM} was never modified)`);
  console.log(dryRun ? '[DRY RUN]\n' : '[APPLYING]\n');

  if (ops.length === 0) console.log('  Nothing to undo.');
  for (const [i, op] of ops.entries()) {
    console.log(`  ${i + 1}. ${op.op.toUpperCase()} ${op.path}`);
    console.log(`       why : ${op.why}`);
  }

  if (dryRun) {
    console.log(`\n  ${ops.length} operation(s) would be applied.`);
    return;
  }

  for (const op of ops) {
    if (op.op === 'set') await setDocument(op.path, op.data);
    else await deleteDocument(op.path);
    console.log(`  applied: ${op.op} ${op.path}`);
  }
  console.log('\n  Rollback complete. Deleting organizers/<uid> also clears the custom claim');
  console.log('  automatically via onOrganizerWritten.');
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
