import { StoreMembershipLockedPriceService } from './store-membership-locked-price.service';
import {
  isRenewalPlanPurchasable,
  resolveVisibleRenewalPlanIds,
  shouldHideRenewalPlanPriceExtras,
} from './membership-renewal-policy.shared';
import type { PlatformMembershipAccessService } from './platform-membership-access.service';

describe('StoreMembershipLockedPriceService', () => {
  const prismaService = {
    storeMembershipLockedPrice: {
      findMany: jest.fn(),
      createMany: jest.fn(),
      deleteMany: jest.fn(),
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

    it('未开通子账号功能时不写入（锁定价不会生效，避免日后开通时突然生效）', async () => {
      accessService.getSubAccountBenefitSnapshot.mockResolvedValue({
        level: 'yearly',
        eligible: true,
        quota: 0,
        quotaMax: 0,
        enabled: false,
        // 从未开通子账号功能
        rawQuota: 0,
        featureOwned: false,
        previousLevel: 'yearly',
      });
      const service = createService();

      await expect(
        service.lockPriceOnFirstDeal({
          storeId: 59,
          planId: 'yearly',
          price: 29900,
          source: 'admin',
        }),
      ).resolves.toBe(false);

      expect(
        prismaService.storeMembershipLockedPrice.createMany,
      ).not.toHaveBeenCalled();
    });

    it('调用方已给出 featureOwned 时不再重复读取能力快照', async () => {
      const service = createService();

      await expect(
        service.lockPriceOnFirstDeal({
          storeId: 18,
          planId: 'yearly',
          price: 36900,
          source: 'purchase',
          featureOwned: true,
        }),
      ).resolves.toBe(true);

      expect(accessService.getSubAccountBenefitSnapshot).not.toHaveBeenCalled();
    });
  });

  describe('resolvePlanPrice', () => {
    it('未开通子账号功能时使用配置价', () => {
      const service = createService();
      const plan = { id: 'lifetime' as const, price: 39800 };

      expect(
        service.resolvePlanPrice({
          plan,
          context: {
            level: 'lifetime',
            renewalLevel: 'lifetime',
            subAccountEnabled: false,
            subAccountFeatureOwned: false,
            subAccountQuota: 0,
            lockedPrices: new Map([['lifetime', 59800]]),
          },
        }),
      ).toEqual({ price: 39800, locked: false });
    });

    it('已开通子账号功能且存在锁定价时使用锁定价', () => {
      const service = createService();
      const plan = { id: 'lifetime' as const, price: 39800 };

      expect(
        service.resolvePlanPrice({
          plan,
          context: {
            level: 'lifetime',
            renewalLevel: 'lifetime',
            subAccountEnabled: true,
            subAccountFeatureOwned: true,
            subAccountQuota: 2,
            lockedPrices: new Map([['lifetime', 59800]]),
          },
        }),
      ).toEqual({ price: 59800, locked: true });
    });

    it('已开通子账号功能但未锁价时回落配置价', () => {
      const service = createService();
      const plan = { id: 'yearly' as const, price: 36900 };

      expect(
        service.resolvePlanPrice({
          plan,
          context: {
            level: 'yearly',
            renewalLevel: 'yearly',
            subAccountEnabled: true,
            subAccountFeatureOwned: true,
            subAccountQuota: 2,
            lockedPrices: new Map(),
          },
        }),
      ).toEqual({ price: 36900, locked: false });
    });

    it('会员到期（实时能力已归零）但仍曾开通子账号功能时，锁定价继续生效', () => {
      const service = createService();
      const plan = { id: 'yearly' as const, price: 36900 };

      expect(
        service.resolvePlanPrice({
          plan,
          context: {
            level: 'free',
            renewalLevel: 'yearly',
            subAccountEnabled: false,
            subAccountFeatureOwned: true,
            subAccountQuota: 8,
            lockedPrices: new Map([['yearly', 58800]]),
          },
        }),
      ).toEqual({ price: 58800, locked: true });
    });
  });

  describe('loadRenewalPricingContext', () => {
    it('聚合子账号能力快照与锁定价', async () => {
      prismaService.storeMembershipLockedPrice.findMany.mockResolvedValue([
        { planId: 'lifetime', price: 59800 },
        { planId: 'yearly', price: 99900 },
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
        select: { planId: true, price: true },
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
