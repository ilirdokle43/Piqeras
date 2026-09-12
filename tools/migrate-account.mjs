#!/usr/bin/env node
/**
 * Moves group identity from one account to another.
 *
 * Written for the 2026-08-26 migration, where a link degraded into a sign-in
 * and left the organizer role stranded on an anonymous account while the Google
 * credential landed on a new one. It copies membership, the organizer record
 * and the display name onto the target, and resolves the two competing
 * display-name claims.
 *
 *   node tools/migrate-account.mjs --from <uid> --to <uid> --name Ilir --dry-run
 *   node tools/migrate-account.mjs --from <uid> --to <uid> --name Ilir
 *   node tools/migrate-account.mjs --to <uid> --verify
 *
 * Properties this tool guarantees:
 *
 *  - **Idempotent.** It reads current state first and emits only the operations
 *    that are actually needed. Running it twice is a no-op the second time.
 *  - **Non-destructive to the source.** It never deletes or modifies anything
 *    under the source uid except the shared display-name claim, which by
 *    definition can only belong to one account. The source stays intact as a
 *    rollback, and the claim can be pointed back.
 *  - **Dry-run first.** --dry-run prints the exact operation list that --apply
 *    would perform, from the same code path.
 */

import { getDocument, setDocument, deleteDocument } from './admin-rest.mjs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { normalizeDisplayName } = require('../functions/lib/domain.js');

function arg(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? fallback : (process.argv[i + 1] ?? fallback);
}

const FROM = arg('--from');
const TO = arg('--to');
const DESIRED_NAME = arg('--name', 'Ilir');
const dryRun = process.argv.includes('--dry-run');
const verifyOnly = process.argv.includes('--verify');

if (!TO) {
  console.error('Usage: node tools/migrate-account.mjs --from <uid> --to <uid> --name <Name> [--dry-run]');
  process.exit(1);
}

const eq = (a, b) =>
  a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b;

/* ------------------------------------------------------------- planning -- */

async function plan() {
  const { displayName, displayNameLower } = normalizeDisplayName(DESIRED_NAME);

  const [
    sourceUser,
    sourceMember,
    sourceOrganizer,
    targetUser,
    targetMember,
    targetOrganizer,
    targetPending,
    targetPrivate,
    desiredClaim,
  ] = await Promise.all([
    FROM ? getDocument(`users/${FROM}`) : null,
    FROM ? getDocument(`approvedMembers/${FROM}`) : null,
    FROM ? getDocument(`organizers/${FROM}`) : null,
    getDocument(`users/${TO}`),
    getDocument(`approvedMembers/${TO}`),
    getDocument(`organizers/${TO}`),
    getDocument(`pendingMembers/${TO}`),
    getDocument(`privateProfiles/${TO}`),
    getDocument(`displayNames/${displayNameLower}`),
  ]);

  if (!targetUser) {
    throw new Error(`users/${TO} does not exist — the target must have signed in first.`);
  }

  const ops = [];
  const notes = [];

  // 1. The desired name claim must point at the target. It is the one shared
  //    resource here: a name can belong to exactly one account.
  if (!desiredClaim) {
    ops.push({
      op: 'set',
      path: `displayNames/${displayNameLower}`,
      data: { uid: TO, claimedAt: new Date() },
      why: `claim "${displayNameLower}" (currently unclaimed)`,
    });
  } else if (desiredClaim.uid !== TO) {
    ops.push({
      op: 'set',
      path: `displayNames/${displayNameLower}`,
      data: { uid: TO, claimedAt: desiredClaim.claimedAt ?? new Date() },
      why: `transfer "${displayNameLower}" from ${desiredClaim.uid} to ${TO}`,
      rollback: `set displayNames/${displayNameLower}.uid back to ${desiredClaim.uid}`,
    });
  } else {
    notes.push(`displayNames/${displayNameLower} already owned by target`);
  }

  // 2. The target's public profile carries the desired name.
  if (
    targetUser.displayName !== displayName ||
    targetUser.displayNameLower !== displayNameLower
  ) {
    ops.push({
      op: 'set',
      path: `users/${TO}`,
      data: {
        uid: TO,
        displayName,
        displayNameLower,
        createdAt: targetUser.createdAt ?? new Date(),
        updatedAt: new Date(),
        locale: targetUser.locale ?? 'sq',
        timeZone: targetUser.timeZone ?? '',
        platform: targetUser.platform ?? 'web',
      },
      why: `rename profile "${targetUser.displayName}" -> "${displayName}"`,
      rollback: `restore users/${TO}.displayName = "${targetUser.displayName}"`,
    });
  } else {
    notes.push(`users/${TO} already named "${displayName}"`);
  }

  // 3. Release the target's stale claim, if it had a different one.
  const staleLower = targetUser.displayNameLower;
  if (staleLower && staleLower !== displayNameLower) {
    const stale = await getDocument(`displayNames/${staleLower}`);
    if (stale && stale.uid === TO) {
      ops.push({
        op: 'delete',
        path: `displayNames/${staleLower}`,
        why: `release the target's old claim "${staleLower}"`,
        rollback: `recreate displayNames/${staleLower} with uid ${TO}`,
      });
    }
  }

  // 4. Approved membership.
  if (!targetMember) {
    ops.push({
      op: 'set',
      path: `approvedMembers/${TO}`,
      data: {
        uid: TO,
        displayName,
        approvedAt: sourceMember?.approvedAt ?? new Date(),
        approvedBy: FROM ? `migration:${FROM}` : 'migration',
      },
      why: 'grant approved membership',
      rollback: `delete approvedMembers/${TO}`,
    });
  } else {
    notes.push(`approvedMembers/${TO} already exists`);
  }

  // 5. Organizer record. Writing it also fires onOrganizerWritten, which is
  //    what sets the {"organizer":true} custom claim — no Auth record is
  //    modified by this tool.
  if (!targetOrganizer) {
    ops.push({
      op: 'set',
      path: `organizers/${TO}`,
      data: {
        uid: TO,
        displayName,
        grantedAt: sourceOrganizer?.grantedAt ?? new Date(),
        grantedBy: FROM ? `migration:${FROM}` : 'migration',
      },
      why: 'grant organizer role (custom claim follows via onOrganizerWritten)',
      rollback: `delete organizers/${TO}`,
    });
  } else {
    notes.push(`organizers/${TO} already exists`);
  }

  // 6. Clear the pending state.
  if (targetPending) {
    ops.push({
      op: 'delete',
      path: `pendingMembers/${TO}`,
      why: 'remove pending status',
      rollback: `recreate pendingMembers/${TO} from the snapshot`,
    });
  } else {
    notes.push(`pendingMembers/${TO} already absent`);
  }

  // 7. The private profile is written by the client from its own verified
  //    token; the tool only reports on it.
  if (!targetPrivate) {
    notes.push(`WARNING privateProfiles/${TO} missing — the client will write it on next load`);
  } else {
    notes.push(`privateProfiles/${TO} present (${targetPrivate.email})`);
  }

  if (FROM) {
    notes.push(`source ${FROM}: left completely intact as rollback`);
    if (sourceUser) notes.push(`  users/${FROM} kept ("${sourceUser.displayName}")`);
    if (sourceMember) notes.push(`  approvedMembers/${FROM} kept`);
    if (sourceOrganizer) notes.push(`  organizers/${FROM} kept`);
  }

  return { ops, notes, displayName, displayNameLower };
}

/* -------------------------------------------------------------- verify --- */

async function verify() {
  const { displayNameLower } = normalizeDisplayName(DESIRED_NAME);
  const checks = [];

  const member = await getDocument(`approvedMembers/${TO}`);
  const organizer = await getDocument(`organizers/${TO}`);
  const pending = await getDocument(`pendingMembers/${TO}`);
  const claim = await getDocument(`displayNames/${displayNameLower}`);
  const user = await getDocument(`users/${TO}`);
  const priv = await getDocument(`privateProfiles/${TO}`);

  checks.push(['approved member', !!member]);
  checks.push(['organizer record', !!organizer]);
  checks.push(['not pending', !pending]);
  checks.push([`owns "${displayNameLower}" claim`, claim?.uid === TO]);
  checks.push(['profile name correct', user?.displayNameLower === displayNameLower]);
  checks.push(['private profile present', !!priv]);

  let ok = true;
  for (const [label, pass] of checks) {
    console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}`);
    if (!pass) ok = false;
  }
  return ok;
}

/* ---------------------------------------------------------------- main --- */

async function main() {
  if (verifyOnly) {
    console.log(`Verifying ${TO}:\n`);
    process.exit((await verify()) ? 0 : 1);
  }

  const { ops, notes } = await plan();

  console.log(`Migration ${FROM ?? '(none)'} -> ${TO}`);
  console.log(dryRun ? '[DRY RUN — nothing will be written]\n' : '[APPLYING]\n');

  if (ops.length === 0) {
    console.log('  Nothing to do — target is already in the desired state.');
  }

  for (const [i, op] of ops.entries()) {
    console.log(`  ${i + 1}. ${op.op.toUpperCase()} ${op.path}`);
    console.log(`       why     : ${op.why}`);
    if (op.data) {
      const shown = Object.fromEntries(
        Object.entries(op.data).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v]),
      );
      console.log(`       data    : ${JSON.stringify(shown)}`);
    }
    if (op.rollback) console.log(`       rollback: ${op.rollback}`);
  }

  if (notes.length) {
    console.log('\n  Notes:');
    for (const n of notes) console.log(`    - ${n}`);
  }

  if (dryRun) {
    console.log(`\n  ${ops.length} operation(s) would be applied. Re-run without --dry-run to apply.`);
    return;
  }

  for (const op of ops) {
    if (op.op === 'set') await setDocument(op.path, op.data);
    else await deleteDocument(op.path);
    console.log(`  applied: ${op.op} ${op.path}`);
  }

  console.log('\n  Verifying:\n');
  const ok = await verify();
  if (!ok) {
    console.error('\n  VERIFICATION FAILED — inspect before doing anything else.');
    process.exit(1);
  }
  console.log('\n  Migration complete.');
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});

void eq;
