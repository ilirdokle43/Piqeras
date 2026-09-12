/**
 * Notification copy — no emulator, no Firebase, no network.
 *
 *   npm --prefix functions test
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { bundleFor, LOCALES } from '../src/messages';

// 06:00 in Tirana, which is 07:00 in Athens and Bucharest.
const DEPARTURE = new Date('2026-09-24T04:00:00.000Z');
// Mid-January, when Tirana is on CET and Athens on EET. Still one hour apart.
const WINTER = new Date('2026-01-15T05:00:00.000Z');

describe('notification language', () => {
  test('an unknown or missing locale falls back to Albanian', () => {
    const sq = bundleFor('sq').tripCreated('Piqeras', DEPARTURE);
    for (const locale of ['de', '', null, undefined, 'EL']) {
      assert.deepEqual(bundleFor(locale).tripCreated('Piqeras', DEPARTURE), sq, String(locale));
    }
  });

  test('a locale-shaped key from Object.prototype cannot leak through', () => {
    // `BUNDLES[locale]` would hand back a function for a token whose stored
    // locale field said "constructor", and the sender would crash on it.
    for (const nasty of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      assert.deepEqual(
        bundleFor(nasty).tripCreated('Piqeras', DEPARTURE),
        bundleFor('sq').tripCreated('Piqeras', DEPARTURE),
        nasty,
      );
    }
  });

  test('every language produces a non-empty title and body for every message', () => {
    for (const locale of LOCALES) {
      const b = bundleFor(locale);
      const produced = [
        b.tripCreated('Piqeras', DEPARTURE),
        b.departureChanged('Piqeras', DEPARTURE),
        b.votingClosingSoon('Piqeras', DEPARTURE),
        b.votingLocked('Piqeras', DEPARTURE),
        b.tripSoon('Piqeras', DEPARTURE, 12),
        b.tripSoon('Piqeras', DEPARTURE, 72),
        b.accessRequested('Ana'),
      ];
      for (const n of produced) {
        assert.ok(n.title.trim().length > 0, `${locale} title`);
        assert.ok(n.body.trim().length > 0, `${locale} body`);
      }
    }
  });
});

describe('notification times match the app', () => {
  /*
   * A push that says 06:00 and an app that says 07:00 for the same departure is
   * worse than either alone — the member cannot tell which one is wrong. These
   * bundles render on the same clock the interface does.
   */

  test('Greek and Romanian notifications carry the shifted hour', () => {
    for (const instant of [DEPARTURE, WINTER]) {
      for (const locale of ['el', 'ro'] as const) {
        const b = bundleFor(locale);
        assert.match(b.tripCreated('Piqeras', instant).body, /07:00/, locale);
        assert.match(b.departureChanged('Piqeras', instant).body, /07:00/, locale);
        assert.match(b.votingLocked('Piqeras', instant).body, /07:00/, locale);
        assert.match(b.tripSoon('Piqeras', instant, 12).body, /07:00/, locale);
        assert.match(b.tripSoon('Piqeras', instant, 72).body, /07:00/, locale);
        assert.match(b.votingClosingSoon('Piqeras', instant).body, /07:00/, locale);
      }
    }
  });

  test('Albanian, English and Italian stay on the trip clock', () => {
    for (const locale of ['sq', 'en', 'it'] as const) {
      const b = bundleFor(locale);
      assert.match(b.tripCreated('Piqeras', DEPARTURE).body, /06:00/, locale);
      assert.match(b.votingLocked('Piqeras', DEPARTURE).body, /06:00/, locale);
      assert.match(b.tripSoon('Piqeras', DEPARTURE, 12).body, /06:00/, locale);
    }
  });

  test('the "tomorrow at" line is zoned too, not just the full dates', () => {
    // This one is a bare time with no date beside it, so a wrong zone here has
    // nothing to give it away.
    assert.match(bundleFor('el').tripSoon('Piqeras', DEPARTURE, 20).body, /07:00/);
    assert.match(bundleFor('sq').tripSoon('Piqeras', DEPARTURE, 20).body, /06:00/);
  });
});
