import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PulseMembershipAdminRenewalPriceService } from './membership-admin-renewal-price.service';
import type { PulseMembershipAccessService } from './membership-access.service';
import type { PulseMembershipAdminMutationStateService } from './membership-admin-mutation-state.service';
import type {
  StoreMembershipLockedPriceService,
  StoreRenewalPricingContext,
} from '../../purely-profit/member/platform-membership/store-membership-locked-price.service';

/** 与平台当前套餐配置保持一致 */
const PLAN_SETTINGS = [
  {
    planId: 'monthly',
    planName: '月度会员',
    price: 4200,
    originalPrice: 4200,
    durationMonths: 1,
    validDays: null,
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  },
  {
    planId: 'quarterly',
    planName: '季度会员',
    price: 10800,
    originalPrice: 14400,
    durationMonths: 3,
    validDays: null,
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  },
  {
    planId: 'yearly',
    planName: '年度会员',
    price: 39800,
    originalPrice: 45600,
    durationMonths: 12,
    validDays: 365,
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  },
  {
    planId: 'lifetime',
    planName: '永久会员',
    price: 59800,
    originalPrice: null,
    durationMonths: null,
    validDays: 730,
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  },
];

const OPERATOR = { id: 7, name: '运营小王' } as never;

/**
 * 管理端「调整续费价格」。
 *
 * 三条不可动摇的约束：
 * 1. 续费价恒等于 `max(配置价, 议定价) + 子账号加价`，与结算路径同源；
 * 2. 含子账号权益的门店，月 / 季档位既不可编辑、也拒绝写入——改了也不会生效；
 * 3. 任何一项输入非法就整批拒绝，不能留下「改了一半」的库。
 */
describe('PulseMembershipAdminRenewalPriceService', () => {
  const tx = {
    storeMembershipPriceOverrideAudit: { createMany: jest.fn() },
  };

  const prismaService = {
    membershipPlanSetting: { findMany: jest.fn() },
    $transaction: jest.fn(),
  };

  const accessService = {
    canAccessAdminMember: jest.fn(),
  };

  const mutationStateService = {
    invalidatePulseDashboardHome: jest.fn(),
  };

  const lockedPriceService = {
    loadRenewalPricingContext: jest.fn(),
    upsertRenewalPriceOverride: jest.fn(),
  };

  const createService = (): PulseMembershipAdminRenewalPriceService =>
    new PulseMembershipAdminRenewalPriceService(
      prismaService as never,
      accessService as unknown as PulseMembershipAccessService,
      mutationStateService as unknown as PulseMembershipAdminMutationStateService,
      lockedPriceService as unknown as StoreMembershipLockedPriceService,
    );

  /** 只关心定价相关的字段，其余给稳定默认值 */
  const stubContext = (
    overrides: Partial<StoreRenewalPricingContext> = {},
  ): void => {
    lockedPriceService.loadRenewalPricingContext.mockResolvedValue({
      level: 'yearly',
      renewalLevel: 'yearly',
      subAccountEnabled: false,
      subAccountFeatureOwned: false,
      subAccountQuota: 0,
      lockedPrices: new Map(),
      lockedPriceOverrides: new Map(),
      lockedSubAccountAmounts: new Map(),
      lockedSubAccountCounts: new Map(),
      ...overrides,
    });
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prismaService.membershipPlanSetting.findMany.mockResolvedValue(PLAN_SETTINGS);
    prismaService.$transaction.mockImplementation(
      async (callback: (client: typeof tx) => Promise<void>) => callback(tx),
    );
    accessService.canAccessAdminMember.mockResolvedValue(true);
    tx.storeMembershipPriceOverrideAudit.createMany.mockResolvedValue({
      count: 0,
    });
    lockedPriceService.upsertRenewalPriceOverride.mockResolvedValue({
      oldPrice: null,
    });
    stubContext();
  });

  describe('listRenewalPrices', () => {
    it('无权访问该会员时抛 NotFound', async () => {
      accessService.canAccessAdminMember.mockResolvedValue(false);

      await expect(
        createService().listRenewalPrices(OPERATOR, 18),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('不含子账号：四个档位都可编辑，未覆盖时按配置价续费', async () => {
      const items = await createService().listRenewalPrices(OPERATOR, 18);

      expect(items.map((item) => item.planId)).toEqual([
        'monthly',
        'quarterly',
        'yearly',
        'lifetime',
      ]);
      expect(items.every((item) => item.editable)).toBe(true);
      expect(items.map((item) => item.renewalPriceDisplay)).toEqual([
        '42',
        '108',
        '398',
        '598',
      ]);
      // 未议定覆盖价：下发 null，前端据此展示「按配置价」
      expect(items.every((item) => item.overridePriceDisplay === null)).toBe(true);
    });

    it('含子账号：月 / 季不可编辑并给出原因，年 / 永久仍可编辑', async () => {
      stubContext({
        subAccountFeatureOwned: true,
        lockedPriceOverrides: new Map([['yearly', 45800]]),
        lockedSubAccountAmounts: new Map([['yearly', 15000]]),
      });

      const items = await createService().listRenewalPrices(OPERATOR, 18);
      const byPlanId = new Map(items.map((item) => [item.planId, item]));

      expect(byPlanId.get('monthly')?.editable).toBe(false);
      expect(byPlanId.get('quarterly')?.editable).toBe(false);
      expect(byPlanId.get('monthly')?.editableReason).toContain('子账号');
      expect(byPlanId.get('yearly')?.editable).toBe(true);
      expect(byPlanId.get('lifetime')?.editable).toBe(true);

      // 年度：议定价 458 高于配置价 398，子账号加价 150 仍然叠加
      expect(byPlanId.get('yearly')?.overridePriceDisplay).toBe('458');
      expect(byPlanId.get('yearly')?.renewalPriceDisplay).toBe('608');

      // 月 / 季不参与子账号加价，展示 0
      expect(byPlanId.get('monthly')?.subAccountAmountDisplay).toBe('0');
    });

    it('配置价涨过议定价后：现续费价按配置价，陈旧议定价不再压价', async () => {
      stubContext({
        // 499 元是配置价 399 元时议定的，随后配置价上调到 598 元
        lockedPriceOverrides: new Map([['lifetime', 49900]]),
      });

      const items = await createService().listRenewalPrices(OPERATOR, 18);
      const lifetime = items.find((item) => item.planId === 'lifetime');

      expect(lifetime?.configPriceDisplay).toBe('598');
      // 库里仍存着议定价（供运营回看），但现续费价必须跟着配置价
      expect(lifetime?.overridePriceDisplay).toBe('499');
      expect(lifetime?.renewalPriceDisplay).toBe('598');
    });
  });

  describe('updateRenewalPrices', () => {
    it('未提交任何档位时抛 BadRequest', async () => {
      await expect(
        createService().updateRenewalPrices(OPERATOR, 18, []),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prismaService.$transaction).not.toHaveBeenCalled();
    });

    it('金额非法时抛 BadRequest，且不进事务', async () => {
      await expect(
        createService().updateRenewalPrices(OPERATOR, 18, [
          { planId: 'yearly', priceDisplay: '-1' },
        ]),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prismaService.$transaction).not.toHaveBeenCalled();
    });

    it('任何一项非法就整批拒绝：合法项也不能落库', async () => {
      await expect(
        createService().updateRenewalPrices(OPERATOR, 18, [
          { planId: 'yearly', priceDisplay: '298' },
          { planId: 'lifetime', priceDisplay: 'abc' },
        ]),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(lockedPriceService.upsertRenewalPriceOverride).not.toHaveBeenCalled();
    });

    it('含子账号的门店改月 / 季档位直接拒绝', async () => {
      stubContext({ subAccountFeatureOwned: true });

      await expect(
        createService().updateRenewalPrices(OPERATOR, 18, [
          { planId: 'monthly', priceDisplay: '30' },
        ]),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prismaService.$transaction).not.toHaveBeenCalled();
    });

    it('合法改动写入覆盖价并留审计，随后失效首页派生数据', async () => {
      lockedPriceService.upsertRenewalPriceOverride.mockResolvedValue({
        oldPrice: 39800,
      });

      await createService().updateRenewalPrices(OPERATOR, 18, [
        { planId: 'yearly', priceDisplay: '298' },
      ]);

      expect(lockedPriceService.upsertRenewalPriceOverride).toHaveBeenCalledWith({
        storeId: 18,
        planId: 'yearly',
        // 298 元 → 29800 分
        overridePrice: 29800,
        // 落库缺行时以配置价兜底
        fallbackConfigPrice: 39800,
        executor: tx,
      });

      expect(tx.storeMembershipPriceOverrideAudit.createMany).toHaveBeenCalledWith({
        data: [
          {
            storeId: 18,
            planId: 'yearly',
            oldPrice: 39800,
            newPrice: 29800,
            operatorUserId: 7,
            operatorName: '运营小王',
          },
        ],
      });
      expect(mutationStateService.invalidatePulseDashboardHome).toHaveBeenCalledTimes(1);
    });

    it('0 元是合法入参，不与「清除覆盖」混淆（取高者后按配置价收）', async () => {
      await createService().updateRenewalPrices(OPERATOR, 18, [
        { planId: 'yearly', priceDisplay: '0' },
      ]);

      expect(lockedPriceService.upsertRenewalPriceOverride).toHaveBeenCalledWith(
        expect.objectContaining({ planId: 'yearly', overridePrice: 0 }),
      );
    });

    it('空金额表示清除覆盖、恢复配置价', async () => {
      await createService().updateRenewalPrices(OPERATOR, 18, [
        { planId: 'yearly', priceDisplay: '' },
      ]);

      expect(lockedPriceService.upsertRenewalPriceOverride).toHaveBeenCalledWith(
        expect.objectContaining({ planId: 'yearly', overridePrice: null }),
      );
    });

    it('值没变化时不留审计、也不失效派生数据', async () => {
      lockedPriceService.upsertRenewalPriceOverride.mockResolvedValue({
        oldPrice: 29800,
      });

      await createService().updateRenewalPrices(OPERATOR, 18, [
        { planId: 'yearly', priceDisplay: '298' },
      ]);

      expect(tx.storeMembershipPriceOverrideAudit.createMany).not.toHaveBeenCalled();
      expect(mutationStateService.invalidatePulseDashboardHome).not.toHaveBeenCalled();
    });
  });
});
