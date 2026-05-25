import type { PlanSnapshot, PresetSubscriptionPlanCode } from './subscriptions.types';

export const SUBSCRIPTION_PLAN_CATALOG: Record<
  PresetSubscriptionPlanCode,
  PlanSnapshot
> = {
  STARTER: { planName: '基础版', maxAccountSeats: 1 },
  GROWTH: { planName: '成长版', maxAccountSeats: 2 },
  PRO: { planName: '专业版', maxAccountSeats: 3 },
};

export function buildCustomSubscriptionPlanName(
  maxAccountSeats: number,
): string {
  return `${maxAccountSeats} 账号版`;
}
