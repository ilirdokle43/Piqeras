#!/usr/bin/env node
/**
 * Wraps the shipped-work report into a standalone page served from the app's
 * own domain, at https://piqeras.web.app/raport.
 *
 * The report is authored as an Artifact fragment — no doctype, no <head>,
 * because the Artifact host supplies them. This adds the document around it so
 * the same file can also be opened by anybody with the link, with no Claude
 * account in the way.
 *
 *   node tools/build-report-page.mjs <source.html>
 *
 * The page is deliberately `noindex`: the owner chose to publish it with the
 * group's real names and departure times, and a link you can send is a
 * different thing from a page search engines hand to strangers.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = process.argv[2];
if (!source) {
  console.error('usage: node tools/build-report-page.mjs <source.html>');
  process.exit(1);
}

const fragment = readFileSync(source, 'utf8');

// The authored file is head-matter (title, fonts, styles) followed by the page
// itself. Splitting on the wrapper keeps the two apart without parsing HTML.
const SPLIT = '<div class="wrap">';
const at = fragment.indexOf(SPLIT);
if (at === -1) throw new Error('no <div class="wrap"> found — did the report change shape?');

let head = fragment.slice(0, at).trim();
let body = fragment.slice(at);

// Any style block further down belongs in the head of a real document.
body = body.replace(/<style>[\s\S]*?<\/style>/g, (block) => {
  head += `\n${block}`;
  return '';
});

const title = /<title>([^<]*)<\/title>/.exec(head)?.[1] ?? 'Piqeras';
const description =
  'What shipped for Piqeras: five languages, per-language clocks, the ' +
  'deliberate countdown offset, and a one-tap share card with the whole ' +
  'travel plan.';

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="description" content="${description}">
<meta property="og:type" content="article">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:url" content="https://piqeras.web.app/raport">
<link rel="icon" type="image/png" sizes="32x32" href="/icons/icon-32.png">
${head}
<style>
  /* The document frame the Artifact host would otherwise supply. */
  :root { color-scheme: light dark; }
  *, *::before, *::after { box-sizing: border-box; }
  body { margin: 0; }
  img { max-width: 100%; }
  [hidden] { display: none !important; }
</style>
</head>
<body>
${body.trim()}
</body>
</html>
`;

const out = join(root, 'web', 'public', 'raport.html');
writeFileSync(out, page, 'utf8');
console.log(`wrote web/public/raport.html  (${page.length} bytes)`);
console.log('served at https://piqeras.web.app/raport');
