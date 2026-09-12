#!/usr/bin/env node
/**
 * Grants approved membership to accounts that existed before the approval
 * system was introduced.
 *
 * Without this, the moment the Google-auth rules go live every existing member
 * — including the organizer — would be treated as a brand-new pending user and
 * locked out of their own trip. It is the one Firestore write the migration
 * needs, and it is trivially reversible: delete the documents it creates.
 *
 *   node tools/seed-membership.mjs --dry-run   show what would happen
 *   node tools/seed-membership.mjs             create the missing records
 *   node tools/seed-membership.mjs --revoke <uid>
 *
 * Run it BEFORE deploying the stricter rules.
 */

import { listDocuments, getDocument, setDocument, deleteDocument } from './admin-rest.mjs';

const dryRun = process.argv.includes('--dry-run');
const revokeIndex = process.argv.indexOf('--revoke');
const revokeUid = revokeIndex === -1 ? null : process.argv[revokeIndex + 1];

async function main() {
  if (revokeUid) {
    const existing = await getDocument(`approvedMembers/${revokeUid}`);
    if (!existing) {
      console.log(`${revokeUid} is not an approved member; nothing to do.`);
      return;
    }
    if (dryRun) {
      console.log(`[dry run] would delete approvedMembers/${revokeUid}`);
      return;
    }
    await deleteDocument(`approvedMembers/${revokeUid}`);
    console.log(`Revoked membership: ${revokeUid}`);
    return;
  }

  const users = await listDocuments('users');
  const approved = new Set((await listDocuments('approvedMembers')).map((m) => m.id));
  const organizers = new Set((await listDocuments('organizers')).map((o) => o.id));

  if (users.length === 0) {
    console.log('No users yet — nothing to migrate.');
    return;
  }

  let created = 0;
  for (const user of users) {
    const marker = organizers.has(user.id) ? ' [organizer]' : '';
    if (approved.has(user.id)) {
      console.log(`  = already a member: ${user.displayName}${marker}`);
      continue;
    }
    if (dryRun) {
      console.log(`  + would approve: ${user.displayName} (${user.id})${marker}`);
      created += 1;
      continue;
    }
    await setDocument(`approvedMembers/${user.id}`, {
      uid: user.id,
      displayName: user.displayName ?? '',
      approvedAt: new Date(),
      approvedBy: 'migration',
    });
    console.log(`  + approved: ${user.displayName}${marker}`);
    created += 1;
  }

  console.log(
    dryRun
      ? `\n[dry run] ${created} membership record(s) would be created.`
      : `\n${created} membership record(s) created.`,
  );

  // An organizer without membership would silently lose their powers, since
  // the rules require both records.
  for (const uid of organizers) {
    if (!users.some((u) => u.id === uid)) {
      console.warn(`  ! organizer ${uid} has no user profile — check this before deploying.`);
    }
  }
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
