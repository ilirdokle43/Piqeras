# Security model

Two sentences carry most of it:

1. **The display name is a label, never a credential.** Every authorization
   decision is made from `request.auth.uid`, from the verified Google identity
   in the token, and from server-owned documents no client can write.
2. **Rules are not filters.** Firestore allows a `list` only when the query's
   own constraints prove the rule holds — which shapes almost every read rule in
   this file.

Rules live in [`firestore.rules`](../firestore.rules) and
[`storage.rules`](../storage.rules), covered by **182 emulator tests** in
[`firebase-rules-tests/`](../firebase-rules-tests).

---

## Identity: Google only

Every user signs in with Google. Anonymous authentication is **disabled** at the
project level, and no client code requests it.

The gate in the rules tests the token's **identities**, not its sign-in
provider:

```
function hasGoogle() {
  return signedIn() && 'google.com' in request.auth.token.firebase.identities;
}
```

That distinction is load-bearing and was verified against the emulator. After
`linkWithPopup` attaches Google to an existing session, that session's token
keeps reporting `sign_in_provider == 'anonymous'` until the next full sign-in,
while `identities` gains `google.com` immediately. A rule written against the
provider would lock a user out of their own account the instant they migrated.

The verified email lives in `privateProfiles/{uid}`, readable **only by its
owner** — not by other members, not by organizers. `users/{uid}` is
group-readable and is enforced email-free by `keys().hasOnly(...)`.

## Three tiers of caller

| Tier | Can do |
|---|---|
| `hasGoogle()` | Claim a display name, read their own profile and their own approval status. Nothing else. |
| `isMember()` | Additionally: the current trip, everyone's responses, the roster, Historiku. |
| `isOrganizer()` | Additionally: drafts, trip management, the approval queue. |

Membership is `approvedMembers/{uid}` — **server-owned, `allow write: if false`
for every client including organizers.** Joining the group is never a client
decision, and deleting the record revokes access on the very next request, which
is what makes organizer-managed removal immediate.

Organizer powers require **both** the organizer record and current membership,
so revoking membership cannot leave a privileged orphan. `manageMembership`
refuses to revoke a sitting organizer's membership — remove the role first.

### Why rules read the collection and not the custom claim

The role is mirrored into an `organizer` custom claim, but **Firestore rules
deliberately do not trust it**. A claim reaches a client only on the next token
refresh, so a revoked organizer would keep write access for up to an hour.
`exists()` costs one read and is correct immediately, in both directions.

The claim exists for the two things that cannot call Firestore: **Storage
rules**, and a synchronous client-side hint. Client-side role state is UI gating
only — being wrong grants nothing.

## The visibility invariant

```
visible === (status !== 'draft')
```

Enforced on **every** write, by the rules themselves:

```
&& 'visible' in incoming()
&& incoming().visible == (incoming().status != 'draft')
```

A client therefore cannot publish a draft by flipping `visible`, nor hide a live
trip from the group. A **cancelled trip stays visible** — it was readable while
live, and retracting that adds a branch for no benefit. Cancelled trips are kept
out of Historiku by the history *query*, and are always rendered with an
explicit cancelled state.

### The draft-list leak (found and fixed 2026-08-26)

An earlier version read:

```
allow list: if isMember();     // never inspects the document
```

Because that branch never touched document data, an unfiltered
`getDocs(collection('trips'))` returned **everything, drafts included**. Proved
against the emulator, then fixed by testing `visible` on both `get` and `list`;
every client query now carries `where('visible','==',true)`, which is what makes
it provable. Seven regression tests pin it shut, including the exact unfiltered
query, and they were re-run against the **deployed ruleset bytes** after release.

## Trip history

`trips/{tripId}/attendees/{id}` holds immutable snapshots: `displayName`,
optional `uid`, `attendance`, optional `note` and `preferredDeparture`, and
`source` (`response` | `manual`).

- **`allow write: if false`** for every client, organizers included. History is
  created and edited only by the `completeTrip` and `saveHistoricalTrip`
  callables, which re-check the caller server-side.
- **No email field, ever.** History is group-readable.
- A historical friend needs **no Firebase account** — a snapshot carries a name,
  and a `uid` only when one genuinely exists.
- Renaming yourself, leaving the group, or an organizer editing the live roster
  cannot rewrite who went to Piqeras. `onUserWritten` propagates a name change
  only to trips whose status is still active.
- `attendeeCount` is recomputed server-side by `onAttendeeWritten` and rejected
  from clients, so a history card cannot claim a turnout it did not have.

`completeTrip` runs in a single Firestore transaction — snapshots, status,
`isCurrent`, `votingLocked` and the count move together or not at all. Original
responses are never deleted.

## One response per member per trip

The response document id **is** the member's uid. A duplicate is not
representable, and `request.auth.uid == uid` is what makes it yours.

## Unique display names

`displayNames/{nameLower}` uses the lowercased name as the document id. Rules
allow `create` and never `update`, so claiming a taken name fails rather than
stealing it. Renaming is a single atomic `WriteBatch`, so a collision rolls back
and the old name survives.

## Ownership cannot be spoofed

| Field | Rule |
|---|---|
| `users/{uid}.uid` | must equal `request.auth.uid` |
| `responses/{uid}.uid` | must equal the doc id, which must equal the caller |
| `privateProfiles.email` | must equal `request.auth.token.email`, with `email_verified` |
| `trips.createdBy` | the caller on create, immutable afterwards |
| `trips.updatedBy` | the caller on every write |
| `createdAt` / `updatedAt` | must equal `request.time` — the **server** clock |
| `visible` | must equal `status != 'draft'` |
| `responseCounts`, `respondedCount`, `attendeeCount` | server-owned, rejected from clients |

Because timestamps are server-stamped, a device with a wrong clock cannot vote
after the deadline or fake when it responded.

## Visibility summary

| Data | Who can read |
|---|---|
| Current trip, history | approved members |
| Draft trips | organizers only |
| Responses, attendee snapshots | approved members |
| Member roster, organizer list | approved members |
| Own profile / own approval status | the owner, even while pending |
| Approval queue (`pendingMembers`) | organizers |
| Verified email (`privateProfiles`) | the owner alone |
| Push tokens | the owner |
| Notification ledger | nobody |

## Removal

Organizer-managed removal **revokes membership, never the account**: it deletes
the approval, profile, name claim, push tokens, and responses on **active**
trips. Responses and attendee snapshots on finished trips are preserved — they
carry their own `displayName`, so history reads correctly after the profile is
gone. The Firebase Auth account is never deleted or disabled automatically, and
re-inviting requires approval again.

Trips are never deleted from a client; they move to `cancelled` or `archived`.
