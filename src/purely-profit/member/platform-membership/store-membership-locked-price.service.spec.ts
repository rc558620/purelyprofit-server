import {
  StoreMembershipLockedPriceService,
  type StoreRenewalPricingContext,
} from './store-membership-locked-price.service';
import {
  isRenewalPlanPurchasable,
  resolveVisibleRenewalPlanIds,
  shouldHideRenewalPlanPriceExtras,
} from './membership-renewal-policy.shared';
import type { PlatformMembershipAccessService } from './platform-membership-access.service';

describe('StoreMembershipLockedPriceService', () => {
  const prismaService = {
    storeMembershipProfile: {
      findMany: jest.fn(),
    },
    storeMembershipLockedPrice: {
      findMany: jest.fn(),
      createMany: jest.fn(),
      upsert: jest.fn(),
      deleteMany: jest.fn(),
      updateMany: jest.fn(),
    },
  };

  const accessService = {
    getSubAccountBenefitSnapshot: jest.fn(),
  };

  const createService = (): StoreMembershipLockedPriceService =>
    new StoreMembershipLockedPriceService(
      prismaService as never,
      accessService as unknown as PlatformMembershipAccessService,
    );

  beforeEach(() => {
    jest.clearAllMocks();
    prismaService.storeMembershipLockedPrice.findMany.mockResolvedValue([]);
    prismaService.storeMembershipLockedPrice.createMany.mockResolvedValue({
      count: 1,
    });
    prismaService.storeMembershipLockedPrice.deleteMany.mockResolvedValue({
      count: 0,
    });
    prismaService.storeMembershipLockedPrice.upsert.mockResolvedValue({});
    prismaService.storeMembershipLockedPrice.updateMany.mockResolvedValue({
      count: 0,
    });
    accessService.getSubAccountBenefitSnapshot.mockResolvedValue({
      level: 'yearly',
      eligible: true,
      quota: 2,
      quotaMax: 10,
      enabled: true,
      rawQuota: 2,
      featureOwned: true,
      previousLevel: 'yearly',
    });
  });

  describe('lockPriceOnFirstDeal', () => {
    it('首次成交写入锁定价', async () => {
      const service = createService();

      await expect(
        service.lockPriceOnFirstDeal({
          storeId: 18,
          planId: 'lifetime',
          price: 59800,
          source: 'admin',
        }),
      ).resolves.toBe(true);

      expect(
        prismaService.storeMembershipLockedPrice.createMany,
      ).toHaveBeenCalledWith({
        data: [
          {
            storeId: 18,
            planId: 'lifetime',
            price: 59800,
            subAccountAmount: null,
            subAccountCount: null,
            source: 'admin',
          },
        ],
        skipDuplicates: true,
      });
    });

    it('已存在锁定价时不覆盖（skipDuplicates 返回 0 条）', async () => {
      prismaService.storeMembershipLockedPrice.createMany.mockResolvedValue({
        count: 0,
      });
      const service = createService();

      await expect(
        service.lockPriceOnFirstDeal({
          storeId: 18,
          planId: 'yearly',
          price: 99900,
          source: 'purchase',
        }),
      ).resolves.toBe(false);
    });

    it('非法价格不写入', async () => {
      const service = createService();

      await expect(
        service.lockPriceOnFirstDeal({
          storeId: 18,
          planId: 'yearly',
          price: -1,
          source: 'purchase',
        }),
      ).resolves.toBe(false);

      expect(
        prismaService.storeMembershipLockedPrice.createMany,
      ).not.toHaveBeenCalled();
    });

    it('未开通子账号功能的门店也要写入（成交价一律留痕）', async () => {
      const service = createService();

      await expect(
        service.lockPriceOnFirstDeal({
          storeId: 59,
          planId: 'yearly',
          price: 29900,
          source: 'admin',
        }),
      ).resolves.toBe(true);

      expect(
        prismaService.storeMembershipLockedPrice.createMany,
      ).toHaveBeenCalledWith({
        data: [
          {
            storeId: 59,
            planId: 'yearly',
            price: 29900,
            subAccountAmount: null,
            subAccountCount: null,
            source: 'admin',
          },
        ],
        skipDuplicates: true,
      });
      // 写入不再受「是否开通子账号」约束，因此不需要再读能力快照
      expect(accessService.getSubAccountBenefitSnapshot).not.toHaveBeenCalled();
    });

    it('带子账号加价与数量时一并落库', async () => {
      const service = createService();

      await service.lockPriceOnFirstDeal({
        storeId: 18,
        planId: 'yearly',
        price: 65000,
        source: 'admin',
        subAccountAmount: 15000,
        subAccountCount: 3,
      });

      expect(
        prismaService.storeMembershipLockedPrice.createMany,
      ).toHaveBeenCalledWith({
        data: [
          {
            storeId: 18,
            planId: 'yearly',
            price: 65000,
            subAccountAmount: 15000,
            subAccountCount: 3,
            source: 'admin',
          },
        ],
        skipDuplicates: true,
      });
    });

    it('upsertDealPrice 覆盖已有成交价（运营重新议定）', async () => {
      const service = createService();

      await service.upsertDealPrice({
        storeId: 18,
        planId: 'yearly',
        price: 75000,
        source: 'admin',
        subAccountAmount: 20000,
        subAccountCount: 5,
      });

      expect(
        prismaService.storeMembershipLockedPrice.upsert,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { storeId_planId: { storeId: 18, planId: 'yearly' } },
          update: expect.objectContaining({
            price: 75000,
            subAccountAmount: 20000,
            subAccountCount: 5,
            source: 'admin',
          }),
        }),
      );
    });

    it('upsertDealPrice 未传子账号字段时不动这两个字段', async () => {
      const service = createService();

      await service.upsertDealPrice({
        storeId: 18,
        planId: 'yearly',
        price: 75000,
        source: 'admin',
      });

      // upsert 只接收单个 options 对象，取第 0 个实参即可
      const [upsertArgs] =
        prismaService.storeMembershipLockedPrice.upsert.mock.calls.at(-1) ?? [];
      const { update } = upsertArgs as { update: Record<string, unknown> };

      expect(update).not.toHaveProperty('subAccountAmount');
      expect(update).not.toHaveProperty('subAccountCount');
    });

    it('upsertDealPrice 忽略非法的子账号加价（负数会把标准总价算小）', async () => {
      const service = createService();

      await service.upsertDealPrice({
        storeId: 18,
        planId: 'yearly',
        price: 75000,
        source: 'admin',
        subAccountAmount: -1,
      });

      expect(
        prismaService.storeMembershipLockedPrice.upsert,
      ).not.toHaveBeenCalled();
    });

    it('upsertDealPrice 忽略非法的子账号数量', async () => {
      const service = createService();

      await service.upsertDealPrice({
        storeId: 18,
        planId: 'yearly',
        price: 75000,
        source: 'admin',
        subAccountCount: 1.5,
      });

      expect(
        prismaService.storeMembershipLockedPrice.upsert,
      ).not.toHaveBeenCalled();
    });

    it('lockPriceOnFirstDeal 忽略非法的子账号加价', async () => {
      const service = createService();

      await expect(
        service.lockPriceOnFirstDeal({
          storeId: 18,
          planId: 'yearly',
          price: 65000,
          source: 'admin',
          subAccountAmount: -100,
        }),
      ).resolves.toBe(false);

      expect(
        prismaService.storeMembershipLockedPrice.createMany,
      ).not.toHaveBeenCalled();
    });
  });

  describe('clearSubAccountAmounts', () => {
    it('只清子账号两列，保留成交总额', async () => {
      const service = createService();
      prismaService.storeMembershipLockedPrice.updateMany.mockResolvedValue({
        count: 2,
      });

      await expect(service.clearSubAccountAmounts(18)).resolves.toBe(2);

      expect(
        prismaService.storeMembershipLockedPrice.updateMany,
      ).toHaveBeenCalledWith({
        where: {
          storeId: 18,
          OR: [
            { subAccountAmount: { not: null } },
            { subAccountCount: { not: null } },
          ],
        },
        data: { subAccountAmount: null, subAccountCount: null },
      });
    });

    it('判据覆盖「只录了数量、加价仍为 NULL」的行', async () => {
      const service = createService();

      await service.clearSubAccountAmounts(18);

      // 只判 subAccountAmount 为空会漏掉这类行，关掉子账号后数量却还挂着
      const [args] =
        prismaService.storeMembershipLockedPrice.updateMany.mock.calls.at(-1) ??
        [];
      const { where } = args as {
        where: { OR: Array<Record<string, unknown>> };
      };

      expect(where.OR).toEqual(
        expect.arrayContaining([{ subAccountCount: { not: null } }]),
      );
    });
  });

  describe('resolvePlanPrice', () => {
    /** 构造定价上下文：未声明的字段取默认，让用例只暴露与断言相关的那一两个变量 */
    const buildContext = (
      overrides: Partial<StoreRenewalPricingContext> = {},
    ): StoreRenewalPricingContext => ({
      level: 'yearly',
      renewalLevel: 'yearly',
      subAccountEnabled: false,
      subAccountFeatureOwned: false,
      subAccountQuota: 0,
      lockedPrices: new Map(),
      lockedSubAccountAmounts: new Map(),
      lockedSubAccountCounts: new Map(),
      ...overrides,
    });

    it('无子账号：续费价 = 配置价，与成交价无关（卖 498 也按 398）', () => {
      const service = createService();
      const plan = { id: 'yearly' as const, price: 39800 };

      expect(
        service.resolvePlanPrice({
          plan,
          context: buildContext({
            lockedPrices: new Map([['yearly', 49800]]),
          }),
        }),
      ).toEqual({ price: 39800 });
    });

    it('无子账号：成交价低于配置价时也按配置价（卖 298 仍按 398）', () => {
      const service = createService();
      const plan = { id: 'yearly' as const, price: 39800 };

      expect(
        service.resolvePlanPrice({
          plan,
          context: buildContext({
            lockedPrices: new Map([['yearly', 29800]]),
          }),
        }),
      ).toEqual({ price: 39800 });
    });

    it('配置价上调后涨价传导给老客', () => {
      const service = createService();
      const plan = { id: 'yearly' as const, price: 59800 };

      expect(
        service.resolvePlanPrice({
          plan,
          context: buildContext({
            lockedPrices: new Map([['yearly', 39800]]),
          }),
        }),
      ).toEqual({ price: 59800 });
    });

    it('配置价下调后降价同样传导给老客（旧模型会被成交价托住）', () => {
      const service = createService();
      const plan = { id: 'yearly' as const, price: 39800 };

      expect(
        service.resolvePlanPrice({
          plan,
          context: buildContext({
            lockedPrices: new Map([['yearly', 49800]]),
          }),
        }),
      ).toEqual({ price: 39800 });
    });

    it('有子账号：续费价 = 配置价 + 子账号加价', () => {
      const service = createService();
      const plan = { id: 'yearly' as const, price: 39800 };

      expect(
        service.resolvePlanPrice({
          plan,
          context: buildContext({
            subAccountFeatureOwned: true,
            subAccountQuota: 2,
            lockedSubAccountAmounts: new Map([['yearly', 10000]]),
            lockedSubAccountCounts: new Map([['yearly', 2]]),
          }),
        }),
      ).toEqual({ price: 49800 });
    });

    it('有子账号时成交价依然不参与定价（卖 598 / 398 都按 498）', () => {
      const service = createService();
      const plan = { id: 'yearly' as const, price: 39800 };
      const context = buildContext({
        subAccountFeatureOwned: true,
        lockedSubAccountAmounts: new Map([['yearly', 10000]]),
      });

      expect(
        service.resolvePlanPrice({
          plan,
          context: { ...context, lockedPrices: new Map([['yearly', 59800]]) },
        }),
      ).toEqual({ price: 49800 });

      expect(
        service.resolvePlanPrice({
          plan,
          context: { ...context, lockedPrices: new Map([['yearly', 39800]]) },
        }),
      ).toEqual({ price: 49800 });
    });

    it('子账号加价按档位独立：永久档读自己的快照', () => {
      const service = createService();
      const plan = { id: 'lifetime' as const, price: 59800 };

      expect(
        service.resolvePlanPrice({
          plan,
          context: buildContext({
            lockedSubAccountAmounts: new Map([['lifetime', 10000]]),
          }),
        }),
      ).toEqual({ price: 69800 });
    });

    it('子账号加价被清空（配额归零）后退化为纯配置价', () => {
      const service = createService();
      const plan = { id: 'yearly' as const, price: 39800 };

      expect(
        service.resolvePlanPrice({
          plan,
          context: buildContext({
            lockedPrices: new Map([['yearly', 50000]]),
            lockedSubAccountAmounts: new Map(),
          }),
        }),
      ).toEqual({ price: 39800 });
    });

    it('会员到期（实时能力已归零）后仍按配置价 + 子账号加价', () => {
      const service = createService();
      const plan = { id: 'yearly' as const, price: 39800 };

      expect(
        service.resolvePlanPrice({
          plan,
          context: buildContext({
            level: 'free',
            renewalLevel: 'yearly',
            subAccountFeatureOwned: true,
            subAccountQuota: 8,
            lockedSubAccountAmounts: new Map([['yearly', 10000]]),
          }),
        }),
      ).toEqual({ price: 49800 });
    });
  });

  describe('listStoresPendingSubAccountBackfill', () => {
    it('只把「年 / 永久档位缺子账号加价」的门店列为待补录', async () => {
      const service = createService();
      prismaService.storeMembershipProfile.findMany.mockResolvedValue([
        { storeId: 18 },
        { storeId: 59 },
      ]);
      prismaService.storeMembershipLockedPrice.findMany.mockResolvedValue([
        { storeId: 18 },
      ]);

      await expect(
        service.listStoresPendingSubAccountBackfill(),
      ).resolves.toEqual([18]);

      // 判据必须限定年 / 永久档位：月 / 季开不了子账号，缺加价不算待补录
      expect(
        prismaService.storeMembershipLockedPrice.findMany,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            planId: { in: ['yearly', 'lifetime'] },
            subAccountAmount: null,
          }),
        }),
      );
    });

    it('没有待补录档位时返回空数组', async () => {
      const service = createService();
      prismaService.storeMembershipProfile.findMany.mockResolvedValue([
        { storeId: 18 },
      ]);
      prismaService.storeMembershipLockedPrice.findMany.mockResolvedValue([]);

      await expect(
        service.listStoresPendingSubAccountBackfill(),
      ).resolves.toEqual([]);
    });
  });

  describe('loadRenewalPricingContext', () => {
    it('聚合子账号能力快照与成交价，并拆分出子账号加价', async () => {
      // 只有 yearly 录入了子账号加价与数量，lifetime 为 null → 后者不进这两张表
      prismaService.storeMembershipLockedPrice.findMany.mockResolvedValue([
        {
          planId: 'lifetime',
          price: 59800,
          subAccountAmount: null,
          subAccountCount: null,
        },
        {
          planId: 'yearly',
          price: 99900,
          subAccountAmount: 15000,
          subAccountCount: 3,
        },
      ]);
      const service = createService();

      await expect(service.loadRenewalPricingContext(18)).resolves.toEqual({
        level: 'yearly',
        renewalLevel: 'yearly',
        subAccountEnabled: true,
        subAccountFeatureOwned: true,
        subAccountQuota: 2,
        lockedPrices: new Map([
          ['lifetime', 59800],
          ['yearly', 99900],
        ]),
        // 存量 / 未录入的 lifetime 按 0 处理，因此不出现在这两张表里
        lockedSubAccountAmounts: new Map([['yearly', 15000]]),
        lockedSubAccountCounts: new Map([['yearly', 3]]),
      });
    });

    it('会员到期时用档案里的原档位与配置额度聚合，续费保护不因到期失效', async () => {
      accessService.getSubAccountBenefitSnapshot.mockResolvedValue({
        level: 'free',
        eligible: false,
        quota: 0,
        quotaMax: 0,
        enabled: false,
        rawQuota: 8,
        featureOwned: true,
        previousLevel: 'yearly',
      });
      const service = createService();

      await expect(service.loadRenewalPricingContext(18)).resolves.toEqual({
        level: 'free',
        // 实时档位已回落为 free，续费档位仍取档案里的年度
        renewalLevel: 'yearly',
        subAccountEnabled: false,
        subAccountFeatureOwned: true,
        // 实时配额被归零，但展示口径退回档案里的配置额度
        subAccountQuota: 8,
        lockedPrices: new Map(),
        lockedSubAccountAmounts: new Map(),
        lockedSubAccountCounts: new Map(),
      });
    });

    it('事务内调用时把 executor 透传给子账号能力快照与锁定价读取', async () => {
      const tx = {
        storeMembershipLockedPrice: {
          findMany: jest.fn().mockResolvedValue([]),
        },
      };
      const service = createService();

      await service.loadRenewalPricingContext(18, tx as never);

      expect(accessService.getSubAccountBenefitSnapshot).toHaveBeenCalledWith(
        18,
        tx,
      );
      expect(tx.storeMembershipLockedPrice.findMany).toHaveBeenCalledWith({
        where: { storeId: 18 },
        select: {
          planId: true,
          price: true,
          subAccountAmount: true,
          subAccountCount: true,
        },
      });
      expect(
        prismaService.storeMembershipLockedPrice.findMany,
      ).not.toHaveBeenCalled();
    });
  });

  describe('resetLockedPrices', () => {
    it('不传 planId 时清空门店全部锁定价', async () => {
      prismaService.storeMembershipLockedPrice.deleteMany.mockResolvedValue({
        count: 2,
      });
      const service = createService();

      await expect(service.resetLockedPrices(18)).resolves.toBe(2);
      expect(
        prismaService.storeMembershipLockedPrice.deleteMany,
      ).toHaveBeenCalledWith({ where: { storeId: 18 } });
    });
  });
});

describe('membership-renewal-policy', () => {
  describe('resolveVisibleRenewalPlanIds', () => {
    it('未开通子账号功能时返回月 / 季 / 年（保持现状）', () => {
      expect(
        resolveVisibleRenewalPlanIds({
          subAccountFeatureOwned: false,
          level: 'lifetime',
        }),
      ).toEqual(['monthly', 'quarterly', 'yearly']);
    });

    it('永久会员已开通子账号功能时只返回永久档位', () => {
      expect(
        resolveVisibleRenewalPlanIds({
          subAccountFeatureOwned: true,
          level: 'lifetime',
        }),
      ).toEqual(['lifetime']);
    });

    it('年度会员已开通子账号功能时只返回年度档位', () => {
      expect(
        resolveVisibleRenewalPlanIds({
          subAccountFeatureOwned: true,
          level: 'yearly',
        }),
      ).toEqual(['yearly']);
    });

    it('档位与子账号能力不一致时按年度兜底', () => {
      expect(
        resolveVisibleRenewalPlanIds({
          subAccountFeatureOwned: true,
          level: 'monthly',
        }),
      ).toEqual(['yearly']);
    });

    it('会员到期后年度档位仍只返回年度（不因实时能力归零而放开月 / 季）', () => {
      expect(
        resolveVisibleRenewalPlanIds({
          subAccountFeatureOwned: true,
          // 续费档位取档案里的原档位，而非已回落为 free 的实时档位
          level: 'yearly',
        }),
      ).toEqual(['yearly']);
    });

    it('会员到期后永久档位仍只返回永久（不能错判成年度）', () => {
      expect(
        resolveVisibleRenewalPlanIds({
          subAccountFeatureOwned: true,
          level: 'lifetime',
        }),
      ).toEqual(['lifetime']);
    });
  });

  describe('isRenewalPlanPurchasable', () => {
    it('未开通子账号功能时所有档位可购买', () => {
      expect(
        isRenewalPlanPurchasable({
          planId: 'monthly',
          subAccountFeatureOwned: false,
        }),
      ).toBe(true);
    });

    it('已开通子账号功能时月 / 季不可购买', () => {
      expect(
        isRenewalPlanPurchasable({
          planId: 'monthly',
          subAccountFeatureOwned: true,
        }),
      ).toBe(false);
      expect(
        isRenewalPlanPurchasable({
          planId: 'quarterly',
          subAccountFeatureOwned: true,
        }),
      ).toBe(false);
      expect(
        isRenewalPlanPurchasable({
          planId: 'yearly',
          subAccountFeatureOwned: true,
        }),
      ).toBe(true);
      expect(
        isRenewalPlanPurchasable({
          planId: 'lifetime',
          subAccountFeatureOwned: true,
        }),
      ).toBe(true);
    });

    it('会员到期后仍禁止降级购买月 / 季', () => {
      expect(
        isRenewalPlanPurchasable({
          planId: 'monthly',
          subAccountFeatureOwned: true,
        }),
      ).toBe(false);
      expect(
        isRenewalPlanPurchasable({
          planId: 'quarterly',
          subAccountFeatureOwned: true,
        }),
      ).toBe(false);
    });
  });

  describe('shouldHideRenewalPlanPriceExtras', () => {
    it('仅永久档位隐藏划线原价与月均价', () => {
      expect(shouldHideRenewalPlanPriceExtras('lifetime')).toEqual({
        hideOriginalPrice: true,
        hideMonthlyPrice: true,
      });
      expect(shouldHideRenewalPlanPriceExtras('yearly')).toEqual({
        hideOriginalPrice: false,
        hideMonthlyPrice: false,
      });
    });
  });
});
