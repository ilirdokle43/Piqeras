# Piqeras

A small web app for one group of friends who go to Piqeras twice a year: see the
next trip, watch the countdown, say whether you are coming, and vote for the
departure time.

**Live: https://piqeras.web.app**

Albanian throughout, with English, Greek, Romanian and Italian available in settings.

Every screen has a share button that turns what is on it into a picture and hands
it to the phone’s share sheet — for dropping the countdown into the group chat.

---

## What it does

| Screen | Path | What it is for |
|---|---|---|
| Sign in | `/` (signed out) | **Vazhdo me Google.** Nothing about the trip is visible until you are through it. |
| Confirm name | `/` (first sign-in) | Confirm the name the group will see, prefilled from Google. |
| Waiting | `/` (pending) | An organizer must approve you. No trip data is shown. |
| Countdown | `/` | Full-bleed sunset, trip title, official date, live countdown. |
| My response | `/pergjigjja` | Attendance, preferred departure date and time, optional note. |
| Group responses | `/grupi` | Everyone's answers, grouped by departure time or by status. |
| **Historiku** | `/historiku` | Past trips, newest first. A trip opens at `/historiku/<id>`. |
| Organizer | `/organizatori` | Trip management, approvals, members, past trips, completing a trip. |

The countdown ticks every second without reloading, and every screen updates in
realtime — when the organizer confirms a date, every open browser sees it
immediately.

## Stack

| Layer | Choice |
|---|---|
| Web | React 18 + TypeScript, Vite 6, hand-rolled router, installable PWA |
| Data | Cloud Firestore (europe-west3) with offline persistence |
| Auth | Firebase Authentication — **Google only**, with organizer approval |
| Server | Cloud Functions v2 (Node 22, europe-west3) |
| Images | Cloud Storage |
| Push | Firebase Cloud Messaging (web push) |
| Hosting | Firebase Hosting |

Firebase project: **`piqeras`**. Everything lives in **europe-west3** so the
functions and the database are not on separate continents.

## Layout

```
firestore.rules          the security model — start here
storage.rules
firestore.indexes.json
shared/domain.ts         countdown, timezone, voting and tally logic (canonical)
functions/               triggers, scheduled job, organizer role management
web/                     the site
firebase-rules-tests/    emulator tests for the rules
tools/                   bootstrap and admin scripts
docs/                    schema, security model, timezone handling, setup
```

`shared/domain.ts` is the single source of truth for anything the server and the
browser both need to agree on — most importantly the departure countdown and
the Europe/Tirane conversion. `node tools/sync-shared.mjs` copies it into
`functions/src/` and `web/src/lib/`; `--check` fails if a copy has drifted.

## Running it

```bash
npm --prefix web run dev
```

Then open http://localhost:5173. It talks to the real Firebase project, so you
see real data.

## Tests

```bash
npm test
```

That runs all three suites:

| Suite | Count | What it covers |
|---|---|---|
| `functions` | 92 | Countdown maths, Europe/Tirane conversion incl. DST, voting window, tally, date precision, history |
| `firebase-rules-tests` | 182 | Every rule, against the Firestore emulator |
| `web` | 160 | Screens, auth flows, link safety, localization, listener cache, layout contract |

The rules suite needs Java for the emulator; on this machine set
`JAVA_HOME=C:/Users/Tdshm/.jdks/jbr-21.0.11`.

## Deploying

```bash
npm --prefix web run build
firebase deploy --project piqeras
```

Or narrow it: `--only hosting`, `--only functions`, `--only firestore:rules`.

## Admin tools

All of these use your `gcloud` credentials and the Firestore REST API, which
bypasses Security Rules the same way the Admin SDK would.

```bash
node tools/grant-organizer.mjs --list          # who is registered, who is an organizer
node tools/grant-organizer.mjs --name "Ilir"   # make somebody an organizer
node tools/seed-membership.mjs --dry-run       # approve pre-existing accounts
node tools/seed-trip.mjs --departure 2027-09-23T06:00
node tools/migrate-trip-schema.mjs --dry-run   # backfill visible/datePrecision/attendeeCount
node tools/snapshot-accounts.mjs <uid> ...     # read-only backup before any migration
node tools/make-icons.py                       # regenerate the PWA icons
```

Every tool that writes supports `--dry-run` and prints the exact operations
first.

Only the **first** organizer needs `grant-organizer.mjs`. After that, organizers
add each other from the dashboard.

## Things worth knowing

- **Google sign-in is required, and membership is approved.** A new Google
  account lands in a pending state and sees nothing until an organizer approves
  it. `approvedMembers` and `organizers` are denied to every client for write.
  See [docs/SECURITY.md](docs/SECURITY.md).
- **History is immutable.** Past trips store attendee *snapshots*, so renaming
  or removing a member never rewrites who went. Historical friends need no
  account at all.
- **`visible === (status !== 'draft')`** is enforced on every write; it is what
  keeps drafts private and what every read query constrains.
- **One response per member per trip** is structural: the response document id
  *is* the member's uid, so an edit overwrites and a duplicate is not
  representable.
- **Display names are unique, case-insensitively**, because the lowercased name
  is a document id and `create` fails if it exists. Renaming is one atomic
  batch.
- **All timestamps are UTC.** Europe/Tirane is applied only at the display edge,
  through `Intl`, so DST is handled by the platform.
  See [docs/TIMEZONE.md](docs/TIMEZONE.md).
- **Web push is optional.** It needs a VAPID key pasted into a build variable
  (see [docs/SETUP.md](docs/SETUP.md)); without it the app runs normally and
  simply does not offer notifications.

## Documentation

- [docs/SCHEMA.md](docs/SCHEMA.md) — collections, fields, queries
- [docs/SECURITY.md](docs/SECURITY.md) — the authorization model and its limits
- [docs/TIMEZONE.md](docs/TIMEZONE.md) — how dates are stored and displayed
- [docs/SETUP.md](docs/SETUP.md) — provisioning, notifications, background image
