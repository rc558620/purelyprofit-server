import { normalizeMembershipProfileFromPaidOrders } from './membership-plan-resolver';
import type { MembershipPlanConfig } from './platform-membership.types';

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
    const profile = {
      currentPlanId: null,
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
    const profile = {
      currentPlanId: null,
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
    const profile = {
      currentPlanId: 'yearly' as const,
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
});
