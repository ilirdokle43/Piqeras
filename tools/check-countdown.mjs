#!/usr/bin/env node
/**
 * Read-only: prints the live trip's departure on every language's clock, both
 * the true remaining time and the shortened figure the app actually shows, so a
 * countdown on screen can be checked against arithmetic rather than intuition.
 *
 * The two columns differ for Greek and Romanian on purpose — see the countdown
 * section of docs/TIMEZONE.md.
 *
 *   node tools/check-countdown.mjs
 */

import { listDocuments } from './admin-rest.mjs';

const ZONES = {
  'Shqip     ': 'Europe/Tirane',
  'English   ': 'Europe/Tirane',
  'Ελληνικά  ': 'Europe/Athens',
  'Română    ': 'Europe/Bucharest',
  'Italiano  ': 'Europe/Rome',
};

const show = (instant, zone) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(instant);

const split = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h ` +
         `${Math.floor((s % 3600) / 60)}m ${s % 60}s`;
};

const trips = await listDocuments('trips');
const current = trips.find((t) => t.isCurrent === true);
if (!current) {
  console.log('No current trip.');
  process.exit(0);
}

const departure = new Date(current.finalDeparture ?? current.proposedDeparture);
const now = new Date();

console.log(`trip:        ${current.title}  (${current.status})`);
console.log(`departure:   ${departure.toISOString()}   <- one absolute instant`);
console.log(`now:         ${now.toISOString()}`);
console.log('');
// Mirrors sameWallClockIn(): the moment this zone's clock reads what Tirana's
// clock reads at departure.
const shiftedTarget = (zone) => {
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Tirane',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(departure).reduce((a, x) => ((a[x.type] = x.value), a), {});
  const wall = `${p.year}-${p.month}-${p.day}T${p.hour % 24}:${p.minute}`;
  // Binary-free approach: guess, then correct against the zone's real offset.
  const guess = new Date(`${wall}:00Z`);
  const seen = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(guess);
  const [gh, gm] = seen.split(':').map(Number);
  const drift = ((gh * 60 + gm) - (Number(p.hour) % 24 * 60 + Number(p.minute)) + 1440) % 1440;
  return new Date(guess.getTime() - (drift > 720 ? drift - 1440 : drift) * 60000);
};

console.log('language     departure reads as             true remaining   app shows');
for (const [label, zone] of Object.entries(ZONES)) {
  console.log(
    `${label} ${show(departure, zone).padEnd(30)} ` +
    `${split(departure - now).padEnd(16)} ${split(shiftedTarget(zone) - now)}`,
  );
}
console.log('');
console.log(`now, in Athens:  ${show(now, 'Europe/Athens')}`);
console.log(`now, in Tirana:  ${show(now, 'Europe/Tirane')}`);
