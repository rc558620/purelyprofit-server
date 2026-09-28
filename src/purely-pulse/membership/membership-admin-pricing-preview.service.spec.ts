import { NotFoundException } from '@nestjs/common';
import { PulseMembershipAdminPricingPreviewService } from './membership-admin-pricing-preview.service';
import type { PulseMembershipAccessService } from './membership-access.service';
import type { PulseMembershipAdminMutationStateService } from './membership-admin-mutation-state.service';
import type { StoreMembershipLockedPriceService } from '../../purely-profit/member/platform-membership/store-membership-locked-price.service';

/** 与平台当前套餐配置保持一致 */
const PLAN_SETTINGS = [
  {
    planId: 'monthly',
    planName: '月度会员',
    price: 4200,
    originalPrice: 4200,
    durationMonths: 1,
    validDays: null,
  },
  {
    planId: 'quarterly',
    planName: '季度会员',
    price: 10800,
    originalPrice: 14400,
    durationMonths: 3,
    validDays: null,
  },
  {
    planId: 'yearly',
    planName: '年度会员',
    price: 39800,
    originalPrice: 45600,
    durationMonths: 12,
    validDays: 365,
  },
  {
    planId: 'lifetime',
    planName: '永久会员',
    price: 59800,
    originalPrice: null,
    durationMonths: null,
    validDays: 730,
  },
];

/**
 * 续费价预览：定价公式必须与结算路径（resolvePlanPrice）完全一致，
 * 即 `当前配置价 + 子账号加价`；成交价**不参与**定价，只回显记账。
 */
describe('PulseMembershipAdminPricingPreviewService', () => {
  const prismaService = {
    membershipPlanSetting: { findMany: jest.fn() },
  };

  const accessService = {
    canAccessAdminMember: jest.fn(),
  };

  const mutationStateService = {
    loadAdminMemberStateOrThrow: jest.fn(),
  };

  const lockedPriceService = {
    loadDealPriceSnapshots: jest.fn(),
  };

  const createService = (): PulseMembershipAdminPricingPreviewService =>
    new PulseMembershipAdminPricingPreviewService(
      prismaService as never,
      accessService as unknown as PulseMembershipAccessService,
      mutationStateService as unknown as PulseMembershipAdminMutationStateService,
      lockedPriceService as unknown as StoreMembershipLockedPriceService,
    );

  const stubSnapshots = (
    overrides: {
      prices?: Map<string, number>;
      subAccountAmounts?: Map<string, number>;
      subAccountCounts?: Map<string, number>;
    } = {},
  ) =>
    lockedPriceService.loadDealPriceSnapshots.mockResolvedValue({
      prices: overrides.prices ?? new Map(),
      subAccountAmounts: overrides.subAccountAmounts ?? new Map(),
      subAccountCounts: overrides.subAccountCounts ?? new Map(),
    });

  beforeEach(() => {
    jest.clearAllMocks();
    prismaService.membershipPlanSetting.findMany.mockResolvedValue(
      PLAN_SETTINGS,
    );
    accessService.canAccessAdminMember.mockResolvedValue(true);
    stubSnapshots({ prices: new Map([['yearly', 49800]]) });
  });

  it('无权访问该会员时抛 NotFound', async () => {
    accessService.canAccessAdminMember.mockResolvedValue(false);

    await expect(
      createService().preview({
        user: {} as never,
        storeId: 18,
        targetLevel: 'annual',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('无子账号：续费价 = 后台配置价，与成交价无关', async () => {
    const result = await createService().preview({
      user: {} as never,
      storeId: 18,
      targetLevel: 'annual',
      priceDisplay: '598',
    });

    // 历史成交 498、本次填 598，续费价都不参与
    expect(result.configPriceDisplay).toBe('398');
    expect(result.subAccountAmountDisplay).toBe('0');
    expect(result.renewalPriceDisplay).toBe('398');
    // 成交价仅回显，供运营记账参考
    expect(result.dealPriceDisplay).toBe('598');
  });

  it('有子账号：续费价 = 配置价 + 子账号加价', async () => {
    stubSnapshots({
      prices: new Map([['yearly', 49800]]),
      subAccountAmounts: new Map([['yearly', 10000]]),
      subAccountCounts: new Map([['yearly', 2]]),
    });

    const result = await createService().preview({
      user: {} as never,
      storeId: 18,
      targetLevel: 'annual',
      priceDisplay: '598',
    });

    // 398 + 100 = 498
    expect(result.renewalPriceDisplay).toBe('498');
  });

  it('本次输入的子账号加价优先于已录入值', async () => {
    stubSnapshots({
      subAccountAmounts: new Map([['yearly', 10000]]),
    });

    const result = await createService().preview({
      user: {} as never,
      storeId: 18,
      targetLevel: 'annual',
      subAccountAmountDisplay: '150',
    });

    expect(result.subAccountAmountDisplay).toBe('150');
    expect(result.renewalPriceDisplay).toBe('548');
  });

  it('本次未填子账号加价时沿用已录入的值', async () => {
    stubSnapshots({
      subAccountAmounts: new Map([['yearly', 10000]]),
    });

    const result = await createService().preview({
      user: {} as never,
      storeId: 18,
      targetLevel: 'annual',
    });

    expect(result.subAccountAmountDisplay).toBe('100');
    expect(result.renewalPriceDisplay).toBe('498');
  });

  it('子账号加价填 0 是有效取值：续费价退化为配置价', async () => {
    const result = await createService().preview({
      user: {} as never,
      storeId: 18,
      targetLevel: 'annual',
      subAccountAmountDisplay: '0',
    });

    expect(result.subAccountAmountDisplay).toBe('0');
    expect(result.renewalPriceDisplay).toBe('398');
  });

  it('永久档位同样按「配置价 + 子账号加价」', async () => {
    stubSnapshots({
      subAccountAmounts: new Map([['lifetime', 10000]]),
    });

    const result = await createService().preview({
      user: {} as never,
      storeId: 18,
      targetLevel: 'lifetime',
    });

    expect(result.configPriceDisplay).toBe('598');
    expect(result.renewalPriceDisplay).toBe('698');
  });

  it('免费会员返回全零占位', async () => {
    const result = await createService().preview({
      user: {} as never,
      storeId: 18,
      targetLevel: 'free',
    });

    expect(result.targetPlanId).toBeNull();
    expect(result.renewalPriceDisplay).toBe('0');
    expect(result.dealPriceDisplay).toBeNull();
  });

  it('未填成交价时 dealPriceDisplay 为 null', async () => {
    const result = await createService().preview({
      user: {} as never,
      storeId: 18,
      targetLevel: 'annual',
    });

    expect(result.dealPriceDisplay).toBeNull();
  });
});
