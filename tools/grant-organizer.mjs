#!/usr/bin/env node
/**
 * Bootstraps the first organizer.
 *
 * After that, organizers add each other from the dashboard, which goes through
 * the `manageOrganizer` callable. This script exists only for the first one —
 * the case where there is nobody who could authorize the grant yet.
 *
 *   node tools/grant-organizer.mjs --list
 *   node tools/grant-organizer.mjs --name "Ilir"
 *   node tools/grant-organizer.mjs --uid  "abc123..."
 *   node tools/grant-organizer.mjs --revoke --name "Ilir"
 *
 * The custom claim is NOT set here. Writing `organizers/{uid}` fires the
 * deployed `onOrganizerWritten` trigger, which mirrors the claim with the
 * Admin SDK. One source of truth, one code path.
 */

import {
  listDocuments,
  getDocument,
  setDocument,
  deleteDocument,
} from './admin-rest.mjs';

function arg(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? null : (process.argv[index + 1] ?? null);
}

const wantsList = process.argv.includes('--list');
const revoke = process.argv.includes('--revoke');
const byName = arg('--name');
const byUid = arg('--uid');

async function main() {
  const users = await listDocuments('users');
  const organizers = await listDocuments('organizers');

  if (wantsList || (!byName && !byUid)) {
    const organizerUids = new Set(organizers.map((o) => o.id));
    console.log('\nMembers:');
    if (users.length === 0) {
      console.log(
        '  (none yet — open the app and enter a name first, then re-run this)',
      );
    }
    for (const user of users) {
      const mark = organizerUids.has(user.id) ? ' [organizer]' : '';
      console.log(`  ${user.id}  ${user.displayName}${mark}`);
    }
    console.log(`\nOrganizers: ${organizers.length}`);
    if (!wantsList) {
      console.log('\nPass --name "<display name>" or --uid <uid> to grant.');
    }
    return;
  }

  let target = null;
  if (byUid) {
    target = users.find((u) => u.id === byUid) ?? { id: byUid, displayName: '' };
  } else {
    const matches = users.filter(
      (u) => (u.displayName ?? '').toLowerCase() === byName.toLowerCase(),
    );
    if (matches.length === 0) {
      console.error(`No member named "${byName}". Run with --list to see the roster.`);
      process.exit(1);
    }
    if (matches.length > 1) {
      console.error(`"${byName}" is ambiguous; pass --uid instead.`);
      process.exit(1);
    }
    target = matches[0];
  }

  if (revoke) {
    if (organizers.length <= 1) {
      console.error('Refusing to remove the last organizer.');
      process.exit(1);
    }
    await deleteDocument(`organizers/${target.id}`);
    console.log(`Revoked organizer: ${target.displayName || target.id}`);
    return;
  }

  if (await getDocument(`organizers/${target.id}`)) {
    console.log(`${target.displayName || target.id} is already an organizer.`);
    return;
  }

  await setDocument(`organizers/${target.id}`, {
    uid: target.id,
    displayName: target.displayName ?? '',
    grantedAt: new Date(),
    grantedBy: 'bootstrap',
  });

  console.log(`Granted organizer: ${target.displayName || target.id}`);
  console.log('The custom claim follows within a few seconds via onOrganizerWritten.');
  console.log('Reload the app (or sign out and in) to pick up the new token.');
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
