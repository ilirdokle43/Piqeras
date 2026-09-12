# Setup

The Firebase project is already provisioned and deployed. This is what was done,
what is left, and how to do it again from scratch.

## Current state

| Thing | Status |
|---|---|
| Firebase project `piqeras` | created, Blaze billing attached |
| Firestore `(default)` | **europe-west3**, rules + indexes deployed |
| Google authentication | enabled (OAuth client auto-provisioned) |
| Anonymous authentication | **disabled** — no longer used |
| Cloud Storage `piqeras.firebasestorage.app` | europe-west3, rules deployed |
| Cloud Functions (6) | deployed to europe-west3 |
| Hosting | live at https://piqeras.web.app |
| First trip | 24 Shtator 2026, 06:00, voting open until 17 Shtator 20:00 |
| Members | approved via the organizer dashboard |
| Organizer | granted |
| Web push VAPID key | **not set** — see below |
| Trip background photo | **not set** — see below |

## Adding a friend

1. They open https://piqeras.web.app and press **Vazhdo me Google**.
2. They confirm the display name the group will see.
3. They land on **Në pritje të miratimit** and see nothing else.
4. You get a notification and a badge on the dashboard; press **Mirato**.
5. Their screen switches to the countdown by itself — no reload needed.

Rejecting or removing somebody revokes access immediately and releases their
name, but never deletes their Google account, and never touches their
attendance on trips that already happened.

## Recording a past trip

Organizer dashboard → **Shto dalje të kaluar**. If the departure time is not
known, leave "Ora e nisjes dihet" off and only the date is stored and shown —
the app never invents a time. Attendees can be picked from current members or
typed in by hand for friends who never had an account.

**Përfundo daljen** turns the current trip into history: it locks voting,
converts responses into immutable snapshots, and moves the trip to Historiku.
It asks explicitly whether to include people who answered *Ndoshta*. The whole
operation is one transaction, so it cannot half-finish.

## Two things left for you

### 1. Background photo

The countdown screen currently paints a CSS sunset. To use the real Piqeras
photo, open the organizer dashboard → **Fotoja e sfondit** → **Ngarko foto**.
JPG, PNG or WEBP, under 8 MB. It uploads to Cloud Storage and appears on every
device immediately.

A landscape shot works best: the layout puts text over the top third and the
bottom third, so keep the horizon roughly central.

### 2. Web push (optional)

Firebase has no API for minting a VAPID key pair, so this is a console step:

1. [Project settings → Cloud Messaging](https://console.firebase.google.com/project/piqeras/settings/cloudmessaging)
2. Under **Web Push certificates**, click **Generate key pair**
3. Copy the key into `web/.env.local`:

   ```
   VITE_FCM_VAPID_KEY=BEl...
   ```

4. Rebuild and redeploy: `npm --prefix web run build && firebase deploy --only hosting`

Until then, `pushState()` returns `unconfigured` and the settings sheet simply
does not offer notifications. **Nothing else is affected** — the app is fully
usable without push, which is a requirement, not a fallback.

The server side is already deployed and waiting: token registration, the
locale-aware message bundles, the fan-out, dead-token pruning, the idempotency
ledger, and the 15-minute scheduled job that sends "voting closes soon" and
"the trip is approaching".

## Notifications: what gets sent

| Event | Trigger | Key |
|---|---|---|
| New trip created | `onTripWritten` | `trip_created:{tripId}` |
| Official departure changed | `onTripWritten` | `departure_changed:{tripId}:{millis}` |
| Voting closes within 24h | `tripMaintenance` | `voting_closing:{tripId}:{deadlineMillis}` |
| Voting locked / date confirmed | `onTripWritten` | `voting_locked:{tripId}:{millis}` |
| Trip within 24h | `tripMaintenance` | `trip_soon:{tripId}:24` |

Each send first *creates* its key in `notificationEvents` inside a transaction.
If the document exists, nothing is sent. Firestore triggers are retried, and the
scheduled job runs every 15 minutes, so this is what makes duplicates
impossible. The person who caused the change is excluded from the fan-out.

## Provisioning from scratch

If this ever has to be rebuilt on a new project:

```bash
firebase projects:create piqeras --display-name "Piqeras"
gcloud billing projects link piqeras --billing-account=<ID>

gcloud services enable \
  firestore.googleapis.com firebaserules.googleapis.com \
  identitytoolkit.googleapis.com cloudfunctions.googleapis.com \
  cloudbuild.googleapis.com artifactregistry.googleapis.com \
  run.googleapis.com eventarc.googleapis.com pubsub.googleapis.com \
  cloudscheduler.googleapis.com storage.googleapis.com \
  firebasestorage.googleapis.com fcm.googleapis.com \
  firebasehosting.googleapis.com --project piqeras

# Create the database EXPLICITLY. `firebase deploy --only firestore` will
# silently create it in nam5 if it does not exist yet.
firebase firestore:databases:create "(default)" --location europe-west3 --project piqeras

# Auth has to be initialised before anonymous sign-in can be switched on,
# otherwise the config endpoint answers CONFIGURATION_NOT_FOUND.
TOKEN=$(gcloud auth print-access-token)
curl -X POST "https://identitytoolkit.googleapis.com/v2/projects/piqeras/identityPlatform:initializeAuth" \
  -H "Authorization: Bearer $TOKEN" -H "x-goog-user-project: piqeras" -d '{}'
curl -X PATCH "https://identitytoolkit.googleapis.com/admin/v2/projects/piqeras/config?updateMask=signIn.anonymous.enabled" \
  -H "Authorization: Bearer $TOKEN" -H "x-goog-user-project: piqeras" \
  -H "Content-Type: application/json" -d '{"signIn":{"anonymous":{"enabled":true}}}'

# The default bucket is a domain-named bucket; gcloud cannot create it directly.
curl -X POST "https://firebasestorage.googleapis.com/v1beta/projects/piqeras/defaultBucket" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"location":"europe-west3"}'

firebase apps:create WEB "Piqeras Web" --project piqeras
firebase deploy --project piqeras

node tools/seed-trip.mjs
node tools/grant-organizer.mjs --name "<your name>"
```

### Gotchas that cost time here

- **First functions deploy fails** with "Permission denied while using the
  Eventarc Service Agent". This is a one-time propagation delay on a new
  project. Wait a few minutes and deploy again; nothing is wrong.
- **Source analysis can time out** during deploy. `FUNCTIONS_DISCOVERY_TIMEOUT=120`
  fixes it, and firebase-functions v7 is faster than v6 here.
- **`gcloud` is a `.cmd` on Windows**, and Node ≥ 20 refuses to `execFileSync` a
  `.cmd` directly (EINVAL). `tools/admin-rest.mjs` goes through the shell.
- **Java is needed for the Firestore emulator** and is not on PATH on this
  machine: `JAVA_HOME=C:/Users/Tdshm/.jdks/jbr-21.0.11`.
