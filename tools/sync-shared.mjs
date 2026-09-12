#!/usr/bin/env node
/**
 * Copies the canonical shared modules into each client.
 *
 * Why a copy and not a workspace package: `firebase deploy --only functions`
 * uploads only the `functions/` directory, so a `file:../shared` dependency
 * resolves at build time and then vanishes in the cloud. Vite would be happy
 * with a workspace; Cloud Functions would not. A generated copy keeps one
 * source of truth without a build system that has to be true in two places.
 *
 *   node tools/sync-shared.mjs           rewrite the copies
 *   node tools/sync-shared.mjs --check   fail if a copy has drifted (CI)
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** source (relative to repo root) -> destinations */
const TARGETS = [
  ['shared/domain.ts', ['functions/src/domain.ts', 'web/src/lib/domain.ts']],
];

const BANNER = (source) =>
  `// GENERATED FILE — do not edit.\n` +
  `// Source of truth: ${source}\n` +
  `// Regenerate with: node tools/sync-shared.mjs\n\n`;

const check = process.argv.includes('--check');
let drifted = 0;

for (const [source, destinations] of TARGETS) {
  const body = BANNER(source) + readFileSync(join(root, source), 'utf8');
  for (const dest of destinations) {
    const path = join(root, dest);
    let current = null;
    try {
      current = readFileSync(path, 'utf8');
    } catch {
      /* missing counts as drifted */
    }
    if (current === body) continue;

    if (check) {
      console.error(`drifted: ${relative(root, path)}`);
      drifted += 1;
    } else {
      writeFileSync(path, body);
      console.log(`wrote ${dest}`);
    }
  }
}

if (check) {
  if (drifted > 0) {
    console.error(`\n${drifted} generated file(s) out of date. Run: node tools/sync-shared.mjs`);
    process.exit(1);
  }
  console.log('shared modules are in sync');
}
