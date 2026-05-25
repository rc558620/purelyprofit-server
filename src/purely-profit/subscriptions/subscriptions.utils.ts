import { BadRequestException } from '@nestjs/common';
import { SubscriptionPlanCode } from '@prisma/client';
import {
  buildCustomSubscriptionPlanName,
  SUBSCRIPTION_PLAN_CATALOG,
} from './subscriptions.constants';
import type { PlanSnapshot } from './subscriptions.types';

export function resolvePlanSnapshot(
  planCode: SubscriptionPlanCode,
  customSeatCount?: number,
): PlanSnapshot {
  if (planCode === SubscriptionPlanCode.CUSTOM) {
    if (!customSeatCount || customSeatCount < 1) {
      throw new BadRequestException('自定义套餐必须提供大于等于 1 的席位数');
    }

    return {
      planName: buildCustomSubscriptionPlanName(customSeatCount),
      maxAccountSeats: customSeatCount,
    };
  }

  return SUBSCRIPTION_PLAN_CATALOG[planCode];
}
