/**
 * Notification copy.
 *
 * Albanian is the default. The sender picks a bundle from the token's `locale`
 * field, written when the member turned notifications on, and falls back to
 * Albanian for anything it does not recognise — including tokens registered
 * before a language existed.
 */

import {
  formatDate,
  formatDateSq,
  formatFull,
  formatFullSq,
  formatTime,
  timeZoneFor,
} from './domain';

export type Locale = 'sq' | 'en' | 'el' | 'ro' | 'it';

/*
 * A notification has to agree with the screen the member opens after tapping
 * it. The app shows times on the clock their language is read on, so these do
 * too — otherwise a Greek member gets a push saying 06:00 and an app saying
 * 07:00 for the same departure.
 */

/** "Πέμπτη, 24 Σεπτεμβρίου 2026, 07:00" — language and clock together. */
const at = (instant: Date, locale: Locale) =>
  formatFull(instant, locale, timeZoneFor(locale));

/** "24 Σεπτεμβρίου 2026" on that language's clock. */
const on = (instant: Date, locale: Locale) =>
  formatDate(instant, locale, timeZoneFor(locale));

/** "07:00" on that language's clock. */
const clock = (instant: Date, locale: Locale) =>
  formatTime(instant, timeZoneFor(locale));

export interface Notification {
  title: string;
  body: string;
}

interface Bundle {
  tripCreated(title: string, departure: Date): Notification;
  departureChanged(title: string, departure: Date): Notification;
  votingClosingSoon(title: string, deadline: Date): Notification;
  votingLocked(title: string, departure: Date): Notification;
  tripSoon(title: string, departure: Date, hoursOut: number): Notification;
  accessRequested(name: string): Notification;
}

const sq: Bundle = {
  tripCreated: (title, departure) => ({
    title: `Piqeras: ${title}`,
    body: `Një dalje e re u shtua. Nisja e propozuar: ${formatFullSq(departure)}. Voto tani!`,
  }),
  departureChanged: (title, departure) => ({
    title: `Ndryshoi nisja — ${title}`,
    body: `Nisja zyrtare është tani ${formatFullSq(departure)}.`,
  }),
  votingClosingSoon: (title, deadline) => ({
    title: `Votimi po mbyllet — ${title}`,
    body: `Ke kohë deri më ${formatDateSq(deadline)} në ${formatTime(
      deadline,
    )} për të zgjedhur orën e nisjes.`,
  }),
  votingLocked: (title, departure) => ({
    title: `Data u konfirmua — ${title}`,
    body: `Nisemi më ${formatFullSq(departure)}. Votimi u mbyll.`,
  }),
  tripSoon: (title, departure, hoursOut) => ({
    title: `Gati për ${title}?`,
    body:
      hoursOut <= 24
        ? `Nisemi nesër në ${formatTime(departure)}. Shihemi te Piqeras!`
        : `Nisemi më ${formatFullSq(departure)}.`,
  }),
  accessRequested: (name) => ({
    title: 'Kërkesë e re për t’u bashkuar',
    body: `${name} po pret miratim për të hyrë në grup.`,
  }),
};

const en: Bundle = {
  tripCreated: (title, departure) => ({
    title: `Piqeras: ${title}`,
    body: `A new trip was added. Proposed departure: ${formatFull(departure, 'en')}. Cast your vote!`,
  }),
  departureChanged: (title, departure) => ({
    title: `Departure changed — ${title}`,
    body: `The official departure is now ${formatFull(departure, 'en')}.`,
  }),
  votingClosingSoon: (title, deadline) => ({
    title: `Voting closes soon — ${title}`,
    body: `You have until ${formatDate(deadline, 'en')} at ${formatTime(
      deadline,
    )} to pick a departure time.`,
  }),
  votingLocked: (title, departure) => ({
    title: `Date confirmed — ${title}`,
    body: `We leave on ${formatFull(departure, 'en')}. Voting is now closed.`,
  }),
  tripSoon: (title, departure, hoursOut) => ({
    title: `Ready for ${title}?`,
    body:
      hoursOut <= 24
        ? `We leave tomorrow at ${formatTime(departure)}. See you at Piqeras!`
        : `We leave on ${formatFull(departure, 'en')}.`,
  }),
  accessRequested: (name) => ({
    title: 'New request to join',
    body: `${name} is waiting for approval to join the group.`,
  }),
};

const el: Bundle = {
  tripCreated: (title, departure) => ({
    title: `Piqeras: ${title}`,
    body: `Προστέθηκε νέα εκδρομή. Προτεινόμενη αναχώρηση: ${at(
      departure,
      'el',
    )}. Ψήφισε τώρα!`,
  }),
  departureChanged: (title, departure) => ({
    title: `Άλλαξε η αναχώρηση — ${title}`,
    body: `Η επίσημη αναχώρηση είναι τώρα ${at(departure, 'el')}.`,
  }),
  votingClosingSoon: (title, deadline) => ({
    title: `Η ψηφοφορία κλείνει — ${title}`,
    body: `Έχεις χρόνο μέχρι τις ${on(deadline, 'el')} στις ${clock(
      deadline,
      'el',
    )} για να διαλέξεις ώρα αναχώρησης.`,
  }),
  votingLocked: (title, departure) => ({
    title: `Η ημερομηνία επιβεβαιώθηκε — ${title}`,
    body: `Φεύγουμε ${at(departure, 'el')}. Η ψηφοφορία έκλεισε.`,
  }),
  tripSoon: (title, departure, hoursOut) => ({
    title: `Έτοιμος για ${title};`,
    body:
      hoursOut <= 24
        ? `Φεύγουμε αύριο στις ${clock(departure, 'el')}. Τα λέμε στο Piqeras!`
        : `Φεύγουμε ${at(departure, 'el')}.`,
  }),
  accessRequested: (name) => ({
    title: 'Νέο αίτημα συμμετοχής',
    body: `Ο/Η ${name} περιμένει έγκριση για να μπει στην παρέα.`,
  }),
};

const ro: Bundle = {
  tripCreated: (title, departure) => ({
    title: `Piqeras: ${title}`,
    body: `A fost adăugată o excursie nouă. Plecare propusă: ${at(
      departure,
      'ro',
    )}. Votează acum!`,
  }),
  departureChanged: (title, departure) => ({
    title: `Plecarea s-a schimbat — ${title}`,
    body: `Plecarea oficială este acum ${at(departure, 'ro')}.`,
  }),
  votingClosingSoon: (title, deadline) => ({
    title: `Votul se închide curând — ${title}`,
    body: `Ai timp până pe ${on(deadline, 'ro')} la ${clock(
      deadline,
      'ro',
    )} să alegi ora plecării.`,
  }),
  votingLocked: (title, departure) => ({
    title: `Data a fost confirmată — ${title}`,
    body: `Plecăm pe ${at(departure, 'ro')}. Votul s-a închis.`,
  }),
  tripSoon: (title, departure, hoursOut) => ({
    title: `Gata de ${title}?`,
    body:
      hoursOut <= 24
        ? `Plecăm mâine la ${clock(departure, 'ro')}. Ne vedem la Piqeras!`
        : `Plecăm pe ${at(departure, 'ro')}.`,
  }),
  accessRequested: (name) => ({
    title: 'Cerere nouă de intrare în grup',
    body: `${name} așteaptă aprobare pentru a intra în grup.`,
  }),
};

const it: Bundle = {
  tripCreated: (title, departure) => ({
    title: `Piqeras: ${title}`,
    body: `È stata aggiunta una nuova gita. Partenza proposta: ${at(
      departure,
      'it',
    )}. Vota adesso!`,
  }),
  departureChanged: (title, departure) => ({
    title: `Partenza cambiata — ${title}`,
    body: `La partenza ufficiale è ora ${at(departure, 'it')}.`,
  }),
  votingClosingSoon: (title, deadline) => ({
    title: `La votazione chiude presto — ${title}`,
    body: `Hai tempo fino al ${on(deadline, 'it')} alle ${clock(
      deadline,
      'it',
    )} per scegliere l’orario di partenza.`,
  }),
  votingLocked: (title, departure) => ({
    title: `Data confermata — ${title}`,
    body: `Partiamo il ${at(departure, 'it')}. La votazione è chiusa.`,
  }),
  tripSoon: (title, departure, hoursOut) => ({
    title: `Pronto per ${title}?`,
    body:
      hoursOut <= 24
        ? `Partiamo domani alle ${clock(departure, 'it')}. Ci vediamo a Piqeras!`
        : `Partiamo il ${at(departure, 'it')}.`,
  }),
  accessRequested: (name) => ({
    title: 'Nuova richiesta di adesione',
    body: `${name} è in attesa di approvazione per entrare nel gruppo.`,
  }),
};

const BUNDLES: Record<Locale, Bundle> = { sq, en, el, ro, it };

export const LOCALES: readonly Locale[] = ['sq', 'en', 'el', 'ro', 'it'];

/**
 * Anything unrecognised — an unset field, an old token, a language we dropped —
 * falls back to Albanian rather than failing to send.
 *
 * The membership check is against the list, not `BUNDLES[locale]`: an indexed
 * lookup would happily return `Object.prototype.constructor` for a token whose
 * locale field said "constructor".
 */
export function bundleFor(locale: string | undefined | null): Bundle {
  return LOCALES.includes(locale as Locale) ? BUNDLES[locale as Locale] : BUNDLES.sq;
}
