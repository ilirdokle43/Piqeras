import type { ReactElement } from 'react';
import { render } from '@testing-library/react';
import { I18nProvider } from '../i18n';
import type { Member, Organizer, Trip, TripResponse } from '../lib/types';
import type { Attendance } from '../lib/domain';

/** 24 September 2026, 06:00 Europe/Tirane. */
export const DEPARTURE = new Date('2026-09-24T04:00:00.000Z');
export const NOW = new Date('2026-08-25T10:00:00.000Z');

export const ME = 'uid_me';

export function makeTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: 'trip_1',
    title: 'Piqeras',
    destination: 'Piqeras, Sarandë',
    description: null,
    status: 'voting',
    proposedDeparture: DEPARTURE,
    finalDeparture: null,
    votingDeadline: new Date('2026-09-17T18:00:00.000Z'),
    votingLocked: false,
    isCurrent: true,
    visible: true,
    datePrecision: 'dateTime',
    returnDate: null,
    memory: null,
    attendeeCount: 0,
    backgroundImagePath: null,
    backgroundImageUrl: null,
    backgroundCredit: null,
    responseCounts: { yes: 0, maybe: 0, no: 0 },
    respondedCount: 0,
    createdAt: NOW,
    createdBy: ME,
    updatedAt: NOW,
    updatedBy: ME,
    ...overrides,
  };
}

export function makeResponse(
  uid: string,
  displayName: string,
  attendance: Attendance,
  preferredDeparture: Date | null = DEPARTURE,
  note: string | null = null,
): TripResponse {
  return {
    uid,
    displayName,
    attendance,
    preferredDeparture: attendance === 'no' ? null : preferredDeparture,
    note,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

export function makeMember(uid: string, displayName: string): Member {
  return {
    uid,
    displayName,
    displayNameLower: displayName.toLowerCase(),
    createdAt: NOW,
  };
}

export function makeOrganizer(uid: string, displayName: string): Organizer {
  return { uid, displayName, grantedAt: NOW, grantedBy: 'bootstrap' };
}

export function loadable<T>(data: T) {
  return { data, loading: false, error: null };
}

export function renderWithI18n(ui: ReactElement) {
  return render(<I18nProvider>{ui}</I18nProvider>);
}
