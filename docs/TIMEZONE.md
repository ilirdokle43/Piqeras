# Dates, times and Europe/Tirane

The trip happens in Albania. The people voting may be anywhere, on devices set
to anything. This is how that is kept straight.

## The rule

**Store UTC instants. Convert at the display edge. Never do calendar arithmetic
on local time.**

Every timestamp in Firestore is a `Timestamp`, which is an absolute instant. No
document anywhere carries a timezone, an offset, or a wall-clock string.

## Why not a fixed offset

Albania is UTC+1 in winter (CET) and UTC+2 in summer (CEST), and the switch
dates move every year — the last Sunday of March and of October, at 01:00 UTC.
A departure at 06:00 local is:

| Date | UTC instant |
|---|---|
| 15 January 2026, 06:00 | `2026-01-15T05:00:00Z` |
| 24 September 2026, 06:00 | `2026-09-24T04:00:00Z` |

Hardcoding `+2` would make the app an hour wrong for roughly half the year, and
would silently break the year Albania changes its rules.

So conversion goes through `Intl.DateTimeFormat` with
`timeZone: 'Europe/Tirane'`, which reads the real IANA database that ships with
the platform.

## The two directions

Both live in [`shared/domain.ts`](../shared/domain.ts).

**Instant → what Tirana's clock says** (`zonedParts`, and the `formatSq`
helpers built on it). Used for every date and time the user reads.

**What Tirana's clock says → instant** (`zonedToInstant`). Used when a member
picks a departure in the date and time pickers. This is the direction people get
wrong: the picker gives you "2026-09-24" and "06:00", and those mean 06:00 *in
Albania*, not 06:00 on the device.

`zonedToInstant` looks the offset up twice — once against a naive guess, then
again against the instant that guess produced — because a single lookup can land
on the wrong side of a DST boundary.

## The awkward hours

| Case | Behaviour |
|---|---|
| **Spring forward** — 02:30 on 29 March 2026 does not exist locally | Resolves to `01:30Z`, which displays as 03:30, just after the jump. No `Invalid Date`. |
| **Autumn back** — 02:30 on 25 October 2026 happens twice | Resolves to the first occurrence. Both instants display as 02:30, which is simply true. |
| **Local midnight** | Renders as `00:00`, never `24:00` (some ICU builds report hour 24 under `hour12: false`). |
| **Near midnight** | 23:30 local on the 24th and 00:30 local on the 25th are 21:30Z and 22:30Z on the same UTC day, and are correctly shown on *different* calendar days. |

Each of these has a test in `functions/test/domain.test.ts`.

## The countdown

`computeCountdown` subtracts two instants. It never touches calendar fields, so a
DST transition inside the countdown window neither gains nor loses an hour — the
remaining real time is the remaining real time.

### The one place this app is deliberately wrong

The countdown **target** is not the departure instant. It is
`sameWallClockIn(departure, readerZone)` — the moment the reader's own clock
shows what Tirana's clock shows at departure.

For Greek and Romanian readers that lands an hour before the group actually
leaves, so their countdown reads an hour short and hits zero, flipping to "we
left", while everyone else is still waiting.

This is not an oversight. The true remaining time is identical in every zone —
a countdown is a gap between two moments, and converting a timezone moves both
ends by the same hour. That was demonstrated with the live trip (departure
`2026-09-23T15:00Z`, showing 24d 23h 24m at 18:36 Athens, which is exactly
18:36 → 18:00 on the Greek clock) and the owner asked for the shortened version
anyway. It is his app; this section exists so the next person to read the code
knows it was a decision rather than a bug, and does not "fix" it.

Written as "the same clock reading, in their zone" rather than `- 3600_000` so
it cannot drift if either country changes its daylight-saving rules.

Two things it does **not** affect: the departure time shown above the countdown
(still the true 18:00 for a Greek reader), and the voting deadline, which is
enforced against the server clock in the Security Rules.

It clamps at zero rather than going negative, which is what lets the UI show
**"U nisëm për Piqeras!"** instead of `-3 days`.

## The reader's clock

Storage is absolute, but the *display* zone follows the interface language,
because the members are not all in Albania:

| Language | Zone | A 06:00 Tirana departure reads as |
|---|---|---|
| Shqip | `Europe/Tirane` | 06:00 |
| English | `Europe/Tirane` | 06:00 |
| Ελληνικά | `Europe/Athens` | 07:00 |
| Română | `Europe/Bucharest` | 07:00 |
| Italiano | `Europe/Rome` | 06:00 |

English is a language, not a country, so it stays on the trip's own clock.
Italy shares Albania's zone, so Italian changes nothing today; it is in the
table (`LOCALE_TIME_ZONES`) so the mapping is a complete answer rather than a
list of exceptions.

**Read and write go through the same zone or neither does.** A screen that
formatted a departure in Greek time but parsed the picker back in Albanian time
would shift every Greek member's vote by an hour, silently, and only for them.
That is why the pickers are bound in `useDates()` alongside the formatters —
`dates.toTimeInput` / `dates.fromInputs` — and why no screen imports the raw
`domain.ts` conversions any more.

Two things deliberately stay in `Europe/Tirane` regardless of who is reading:

- **The date-only anchor** (midday). A date-only trip has no time to convert,
  and pinning it keeps the stored instant identical no matter who recorded it.
  Every European zone renders midday-in-Tirana as the same calendar day.
- **The grouping key** (`exactSlotKey`). It must not depend on the viewer, or
  the group screen would split people into different slots for a Greek reader
  than for an Albanian one. Only the *label* follows the reader.

Where the reader's clock actually disagrees with the trip's, the home screen and
the response form say so (`timeZoneNotice`). The check is
`readsAsDifferentTime`, which compares rendered times rather than zone ids — so
Italian, which always agrees, shows no notice, and the notice is still correct
during the fortnight when two zones' daylight-saving switches have not lined up.

Push notifications render through the same table, so a notification and the
screen it opens never disagree about the hour.

## Grouping

The group screen groups people by the *local wall clock* they chose
(`exactSlotKey`), not by the raw instant. Two people who both picked 06:00 land
in the same group even if their browsers are in different timezones — and a
choice at 01:00 local does not get split across a UTC midnight boundary.

## Deadlines

The voting deadline is compared against `request.time` — the **server's** clock —
inside the Security Rules. A device with a wrong clock, or a deliberately
adjusted one, cannot vote late. The client also checks the deadline, but only so
it can explain itself; the enforcement is server-side.

## The clock in the UI

`useNow` ticks once a second, aligned to the second boundary, and re-syncs on
`visibilitychange` and `focus`. Browsers throttle timers in background tabs, so
without that a phone left on the home screen for an hour would come back showing
an hour-stale countdown on its first painted frame.
