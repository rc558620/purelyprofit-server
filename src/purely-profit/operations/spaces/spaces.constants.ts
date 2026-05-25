export const SPACE_STATUS_VALUES = [
  'idle',
  'occupied',
  'reserved',
  'cleaning',
] as const;

export const SPACE_RESERVATION_STATUS_VALUES = [
  'pending',
  'fulfilled',
  'cancelled',
] as const;

export const SPACE_SESSION_STATUS_VALUES = ['active', 'settled'] as const;

export const SPACE_BILLING_MODE_VALUES = [
  'timed',
  'items',
  'mixed',
  'countdown',
] as const;

export type SpaceStatusValue = (typeof SPACE_STATUS_VALUES)[number];
export type SpaceReservationStatusValue =
  (typeof SPACE_RESERVATION_STATUS_VALUES)[number];
export type SpaceSessionStatusValue =
  (typeof SPACE_SESSION_STATUS_VALUES)[number];
export type SpaceBillingModeValue = (typeof SPACE_BILLING_MODE_VALUES)[number];
