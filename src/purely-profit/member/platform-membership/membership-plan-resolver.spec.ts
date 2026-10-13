import { normalizeMembershipProfileFromPaidOrders } from './membership-plan-resolver';
import type {
  MembershipPlanConfig,
  StoreMembershipProfileRecord,
} from './platform-membership.types';

const NOW = new Date('2026-09-12T00:00:00.000Z').getTime();

const plans: Pick<
  MembershipPlanConfig,
  'id' | 'name' | 'durationMonths' | 'validDays'
>[] = [
  { id: 'monthly', name: '月度会员', durationMonths: 1, validDays: 30 },
  { id: 'yearly', name: '年度会员', durationMonths: null, validDays: 365 },
];

const buildPaidOrder = (
  planId: 'monthly' | 'yearly',
  createdAt: Date,
): { planId: 'monthly' | 'yearly'; createdAt: Date } => ({ planId, createdAt });

describe('normalizeMembershipProfileFromPaidOrders', () => {
  it('档案已被显式管理（startsAt 非空）且管理员降级为免费时，不回溯付费订单重建会员', () => {
    // 显式标注为 StoreMembershipProfileRecord：接口新增必填字段时能在此处直接报错
    const profile: StoreMembershipProfileRecord = {
      id: 1,
      storeId: 18,
      currentPlanId: null,
      previousPlanId: null,
      startsAt: new Date('2026-09-01T00:00:00.000Z'),
      expiresAt: null,
      totalPoints: 0,
      availablePoints: 0,
    };

    const result = normalizeMembershipProfileFromPaidOrders({
      profile,
      paidOrders: [
        buildPaidOrder('yearly', new Date('2026-08-01T00:00:00.000Z')),
      ],
      plans,
      nowMs: NOW,
    });

    expect(result.currentPlanId).toBeNull();
    expect(result.expiresAt).toBeNull();
  });

  it('档案从未显式管理（startsAt 为空）时，仍可用历史付费订单自愈重建', () => {
    const profile: StoreMembershipProfileRecord = {
      id: 2,
      storeId: 18,
      currentPlanId: null,
      previousPlanId: null,
      startsAt: null,
      expiresAt: null,
      totalPoints: 0,
      availablePoints: 0,
    };

    const result = normalizeMembershipProfileFromPaidOrders({
      profile,
      paidOrders: [
        buildPaidOrder('yearly', new Date('2026-08-01T00:00:00.000Z')),
      ],
      plans,
      nowMs: NOW,
    });

    expect(result.currentPlanId).toBe('yearly');
    expect(result.expiresAt).not.toBeNull();
    expect(result.expiresAt!.getTime()).toBeGreaterThan(NOW);
  });

  it('档案已生效时不做任何重建', () => {
    const profile: StoreMembershipProfileRecord = {
      id: 3,
      storeId: 18,
      currentPlanId: 'yearly' as const,
      previousPlanId: null,
      startsAt: new Date('2026-08-01T00:00:00.000Z'),
      expiresAt: new Date('2027-08-01T00:00:00.000Z'),
      totalPoints: 0,
      availablePoints: 0,
    };

    const result = normalizeMembershipProfileFromPaidOrders({
      profile,
      paidOrders: [
        buildPaidOrder('monthly', new Date('2026-08-01T00:00:00.000Z')),
      ],
      plans,
      nowMs: NOW,
    });

    expect(result).toBe(profile);
  });

  it('nowMs 用 DB 时钟判定：同一份订单，nowMs 不同则重建结论不同', () => {
    // 回归：重建用 order.createdAt（DB 时钟）当基准推导 expiresAt，
    // 判定却用 Date.now()（应用时钟）就是跨时钟源比较——DB 慢于应用时
    // 到期时间被算早，门店被提前判过期。此处证明 nowMs 注入真实生效。
    const profile: StoreMembershipProfileRecord = {
      id: 1,
      storeId: 18,
      currentPlanId: null,
      previousPlanId: null,
      startsAt: null,
      expiresAt: null,
      totalPoints: 0,
      availablePoints: 0,
    };
    // 2026-08-01 下单月度 → expiresAt = 2026-08-31
    const paidOrders = [
      buildPaidOrder('monthly', new Date('2026-08-01T00:00:00.000Z')),
    ];

    const withDbClockBeforeExpiry = normalizeMembershipProfileFromPaidOrders({
      profile,
      paidOrders,
      plans,
      nowMs: new Date('2026-08-15T00:00:00.000Z').getTime(),
    });
    const withDbClockAfterExpiry = normalizeMembershipProfileFromPaidOrders({
      profile,
      paidOrders,
      plans,
      nowMs: new Date('2026-09-05T00:00:00.000Z').getTime(),
    });

    expect(withDbClockBeforeExpiry.currentPlanId).toBe('monthly');
    // 过期后不得把会员「买回来」
    expect(withDbClockAfterExpiry).toBe(profile);
  });
});
