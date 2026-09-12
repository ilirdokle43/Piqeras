import { initializeApp } from 'firebase-admin/app';
import { setGlobalOptions } from 'firebase-functions/v2';
import { REGION } from './config';

initializeApp();

setGlobalOptions({
  region: REGION,
  // A friends-of-friends group. Capping instances keeps a runaway loop from
  // becoming a runaway bill.
  maxInstances: 5,
});

export { manageOrganizer } from './organizers';
export { requestAccess, manageMembership } from './membership';
export { completeTrip, saveHistoricalTrip, onAttendeeWritten } from './history';
export {
  onResponseWritten,
  onUserWritten,
  onTripWritten,
  onOrganizerWritten,
  onPendingMemberCreated,
} from './triggers';
export { tripMaintenance } from './schedule';
