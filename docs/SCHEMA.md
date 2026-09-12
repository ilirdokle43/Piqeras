# Piqeras — Data model

Firebase project `piqeras`, Firestore `(default)` in **europe-west3**.

All timestamps are stored as Firestore `Timestamp` values, which are UTC
instants. Nothing in the database carries a timezone or a local wall-clock
string. Conversion to **Europe/Tirane** happens only at the display edge, on
each client, using a real IANA timezone implementation (`Intl` /
`java.time.ZoneId`), so daylight-saving transitions are handled by the platform
rather than by a hardcoded offset. See [TIMEZONE.md](TIMEZONE.md).

---

## `users/{uid}`

One document per anonymous Firebase Auth account. `{uid}` is the Auth uid.

| Field | Type | Notes |
|---|---|---|
| `uid` | string | Equals the document id. Enforced by rules. |
| `displayName` | string | 2–24 chars, trimmed. Visible to the whole group. |
| `displayNameLower` | string | `displayName.lower()`. Enforced by rules to match. |
| `createdAt` | timestamp | Server-stamped on create, immutable thereafter. |
| `updatedAt` | timestamp | Server-stamped on every write. |
| `locale` | string? | `sq` \| `en`. |
| `timeZone` | string? | IANA id reported by the device, diagnostic only. |
| `platform` | string? | `android` \| `web`. |

The display name is **never** used for authentication or authorization. It is a
label attached to a uid, nothing more.

### `users/{uid}/tokens/{token}`

FCM registration tokens, private to the owner.

| Field | Type | Notes |
|---|---|---|
| `token` | string | Equals the document id. |
| `platform` | string | `android` \| `web`. |
| `locale` | string? | Interface language, used to pick the notification language. One of `sq`, `en`, `el`, `ro`, `it`. |
| `createdAt` | timestamp | |
| `lastSeenAt` | timestamp | Server-stamped; refreshed on every app start. |

The fan-out reads these with a collection-group query through the Admin SDK,
which bypasses rules. Tokens rejected by FCM as `UNREGISTERED` are deleted by
the sender.

---

## `displayNames/{nameLower}`

Case-insensitive uniqueness index. **The lowercased name is the document id**,
so uniqueness is a property of the database rather than of a check the client
remembers to run.

| Field | Type | Notes |
|---|---|---|
| `uid` | string | Owner of the claim. |
| `claimedAt` | timestamp | Server-stamped. |

Claiming a name is a `create`, which fails with `PERMISSION_DENIED` if the
document already exists (rules allow `create` but never `update`). Renaming is
one atomic `WriteBatch`:

1. `create displayNames/{newLower}`
2. `delete displayNames/{oldLower}`
3. `update users/{uid}`

If step 1 collides, the whole batch fails and the old name stays intact. There
is no window in which a user has two names or none.

---

## `organizers/{uid}`

**Server-owned. No client can write here under any condition.**

| Field | Type | Notes |
|---|---|---|
| `uid` | string | Equals the document id. |
| `displayName` | string | Denormalised for the "manage organizers" screen. |
| `grantedAt` | timestamp | |
| `grantedBy` | string | uid of the granting organizer, or `"bootstrap"`. |

Written only by the `manageOrganizer` callable function or by
`tools/grant-organizer.mjs`, both using the Admin SDK. Firestore rules treat
`exists(organizers/$(uid))` as the authoritative organizer test; the mirrored
`organizer` custom claim exists for Storage rules and for fast client-side UI
gating only.

---

## `trips/{tripId}`

| Field | Type | Notes |
|---|---|---|
| `title` | string | e.g. `Piqeras`. 1–60 chars. |
| `destination` | string | e.g. `Piqeras, Sarandë`. |
| `description` | string? | ≤ 500 chars. |
| `status` | string | `draft` \| `voting` \| `confirmed` \| `completed` \| `cancelled` \| `archived` |
| `proposedDeparture` | timestamp | The organizer's initial proposal. Always present. |
| `finalDeparture` | timestamp? | Set when the organizer confirms. Required when `status == 'confirmed'`. |
| `votingDeadline` | timestamp? | After this instant, responses are read-only. |
| `votingLocked` | boolean | Manual lock, independent of the deadline. |
| `isCurrent` | boolean | Exactly one trip should carry `true`. |
| `visible` | boolean | **Invariant: `visible == (status != 'draft')`**, enforced on every write. This is the member read gate, and every client query constrains it. |
| `datePrecision` | `dateOnly` \| `dateTime` | Whether `proposedDeparture` carries a real time. A `dateOnly` trip never renders a clock value. |
| `returnDate` | timestamp? | Optional, for multi-day historical trips. |
| `memory` | string? | Optional post-trip note, distinct from the pre-trip `description`. |
| `attendeeCount` | number | **Function-owned**, recomputed by `onAttendeeWritten`. |
| `backgroundImagePath` | string? | Storage object path. |
| `backgroundImageUrl` | string? | Download URL cached for fast first paint. |
| `backgroundCredit` | string? | Optional photo credit. |
| `responseCounts` | map | `{yes, maybe, no}`. **Function-owned**, rejected from clients. |
| `respondedCount` | number | **Function-owned**. |
| `createdAt` / `createdBy` | timestamp / string | Immutable after create. |
| `updatedAt` / `updatedBy` | timestamp / string | Server-stamped, uid enforced. |

**`proposedDeparture` is the canonical temporal anchor for every trip**,
historical ones included. There is deliberately no second `tripDate` field: a
parallel date would duplicate every sort, index, format and test path. For a
trip recorded from memory the name is a little stale, but the meaning is fixed —
*the instant this trip is anchored to*. When `datePrecision` is `dateOnly` the
anchor is **12:00 Europe/Tirane** on that date, chosen because midnight is
22:00 UTC the previous day and one slip to UTC would display the wrong date.

**Effective departure** — the instant the countdown counts to — is
`finalDeparture ?? proposedDeparture`. When `finalDeparture` is null the UI
must show that the date is still being voted on rather than presenting the
proposal as official.

`draft` trips are readable only by organizers. Every other status is readable
by every signed-in member, which is what keeps trip history available.

Trips are never deleted from a client; they move to `cancelled` or `archived`
so past responses survive.

### `trips/{tripId}/responses/{uid}`

**The document id is the member's uid.** This is the structural guarantee of
"one current response per member per trip" — editing overwrites, and no client
can produce a duplicate regardless of what it sends.

| Field | Type | Notes |
|---|---|---|
| `uid` | string | Equals the document id and `request.auth.uid`. |
| `displayName` | string | Denormalised so the group screen needs no join. Re-synced by `onUserNameChanged`. |
| `attendance` | string | `yes` \| `maybe` \| `no` |
| `preferredDeparture` | timestamp? | **Required** unless `attendance == 'no'`, in which case it must be absent or null. |
| `note` | string? | ≤ 140 chars. e.g. `Nisem pas pune`. |
| `createdAt` | timestamp | Immutable. |
| `updatedAt` | timestamp | Server-stamped; shown as "last saved". |

Writes are accepted only while voting is open: `votingLocked == false`, status
in `voting`/`confirmed`, and `request.time < votingDeadline` when a deadline is
set. The deadline is compared against the **server's** clock, so a device with a
wrong clock cannot vote late.

---

## `trips/{tripId}/attendees/{attendeeId}`

Immutable snapshots of who was actually on a past trip. **Server-owned** —
`allow write: if false` for every client, organizers included. Written only by
the `completeTrip` and `saveHistoricalTrip` callables.

| Field | Type | Notes |
|---|---|---|
| `displayName` | string | The name **at the time**. Never re-read from a live profile. |
| `uid` | string? | Present only if that person had an account. Absent for a historical friend. |
| `attendance` | string | `yes` \| `maybe` \| `no`. Only `yes`/`maybe` count towards `attendeeCount`. |
| `note` | string? | |
| `preferredDeparture` | timestamp? | Only for trips that were voted on in the app. |
| `source` | `response` \| `manual` | Converted from a vote, or typed in by an organizer. |
| `createdAt` | timestamp | |

Document id is the uid where one exists, otherwise a generated id — so a
historical attendee needs **no Firebase account**, and no fake votes are
fabricated to represent one.

Deliberately **no email field**: this collection is group-readable.

Because the name is copied in, renaming yourself, leaving the group, or an
organizer editing the roster cannot rewrite history. `onUserWritten` propagates a
name change only to trips whose status is still active.

---

## `notificationEvents/{eventKey}`

Idempotency ledger. Closed to all clients.

The document id **is** the deduplication key, and the sender creates it with a
`create` inside a transaction before sending. A second attempt to notify the
same event fails to create and sends nothing.

| Event | `eventKey` |
|---|---|
| New trip created | `trip_created:{tripId}` |
| Official departure changed | `departure_changed:{tripId}:{millis}` |
| Voting closing soon | `voting_closing:{tripId}:{deadlineMillis}` |
| Voting locked / date confirmed | `voting_locked:{tripId}:{finalMillis}` |
| Trip approaching | `trip_soon:{tripId}:{hoursOut}` |

| Field | Type |
|---|---|
| `type` | string |
| `tripId` | string |
| `createdAt` | timestamp |
| `sentCount` / `failureCount` | number |
| `status` | `pending` \| `sent` \| `failed` |

---

## Storage

```
trips/{tripId}/background/{fileName}
```

Written only by organizers (custom-claim check, since Storage rules cannot read
Firestore). Max 8 MB, `image/jpeg|png|webp` only.

---

## Query surface

| Screen | Query |
|---|---|
| Home | `trips where visible == true and isCurrent == true limit 1` (realtime) |
| Home summary | the trip doc's own `responseCounts` — no fan-in read |
| Group responses | `trips/{id}/responses` (realtime, ordered client-side) |
| Roster / "no response" | `users` (realtime) minus responded uids |
| Historiku | `trips where visible == true and status in ['completed','archived'] orderBy proposedDeparture desc` |
| Trip detail | `trips/{id}` plus `trips/{id}/attendees` |

Composite indexes for the last two are declared in `firestore.indexes.json`.
