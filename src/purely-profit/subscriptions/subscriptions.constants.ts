import type {
  PlanSnapshot,
  PresetSubscriptionPlanCode,
} from './subscriptions.types';

export const SUBSCRIPTION_PLAN_CATALOG: Record<
  PresetSubscriptionPlanCode,
  PlanSnapshot
> = {
  starter: { planName: '基础版', maxAccountSeats: 1 },
  growth: { planName: '成长版', maxAccountSeats: 2 },
  pro: { planName: '专业版', maxAccountSeats: 3 },
};

export function buildCustomSubscriptionPlanName(
  maxAccountSeats: number,
): string {
  return `${maxAccountSeats} 账号版`;
}
