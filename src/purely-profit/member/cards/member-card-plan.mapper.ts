// 卡模板行数据 → 接口响应：分转元、Date 转毫秒、派生字段回填
import type { MemberCardPlan } from '@prisma/client';
import { Money } from '../../../shared/money.utils';
import type { MemberCardPlanDto } from './dto/member-card-plan.response.dto';

/** 卡模板的派生聚合：不落库，由售卡订单反查得到 */
export interface MemberCardPlanAggregates {
  /** 累计售出张数（已支付售卡订单的数量合计），无订单记录时不下发 */
  soldCount?: number;
}

/**
 * 单条卡模板的响应映射。
 *
 * 金额只允许经 Money 换算，禁止在这里手写 /100 或 *100，
 * 否则元 / 分口径会在不同接口之间漂移。
 */
export function mapMemberCardPlan(
  row: MemberCardPlan,
  aggregates: MemberCardPlanAggregates = {},
): MemberCardPlanDto {
  return {
    id: String(row.id),
    name: row.name,
    kind: row.kind,
    price: Money.fromDbCents(row.price).toOutputYuan(),
    originalPrice:
      row.originalPrice === null
        ? undefined
        : Money.fromDbCents(row.originalPrice).toOutputYuan(),
    validDays: row.validDays,
    totalTimes: row.totalTimes ?? undefined,
    perUseTimes: row.perUseTimes,
    usableSpaceTypes: [...row.usableSpaceTypes],
    usableWeekdays: [...row.usableWeekdays],
    maxGuestPerUse: row.maxGuestPerUse ?? undefined,
    purchaseLimit: row.purchaseLimit ?? undefined,
    soldCount: aggregates.soldCount,
    isActive: row.isActive,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
}
