import { SubscriptionPlanCode } from '@prisma/client';

export interface PlanSnapshot {
  planName: string;
  maxAccountSeats: number;
}

export interface StoreSeatSummary {
  maxAccountSeats: number;
  activeSeatCount: number;
  availableSeatCount: number;
}

export type PresetSubscriptionPlanCode = Exclude<
  SubscriptionPlanCode,
  'CUSTOM'
>;
