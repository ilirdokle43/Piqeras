/**
 * Functions run in the same region as Firestore (europe-west3) so a trigger
 * does not pay a cross-continent round trip for every read it makes.
 */
export const REGION = 'europe-west3';

/** How far ahead of the voting deadline the reminder goes out. */
export const VOTING_REMINDER_HOURS = 24;

/** How far ahead of departure the "trip is approaching" push goes out. */
export const TRIP_REMINDER_HOURS = 24;

/**
 * Grace period after departure before a trip is auto-completed. Long enough
 * that a trip is never marked finished while the group is still leaving.
 */
export const COMPLETE_AFTER_DEPARTURE_HOURS = 12;
