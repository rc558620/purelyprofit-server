import { MembershipRenewalService } from './membership-renewal.service';
import {
  buildPlanPresentationSignature,
  computePresentationVersion,
  MEMBERSHIP_PLAN_PRESENTATION_VERSION,
} from './membership-plan-resolver';
import { StoreMembershipLockedPriceService } from './store-membership-locked-price.service';
import type { PlatformMembershipAccessService } from './platform-membership-access.service';

/**
 * 商家端续费页套餐列表（`GET /platform-membership/plans`）端到端用例。
 *
 * 用真实 `StoreMembershipLockedPriceService` + 真实 `loadPlanCatalog`，
 * 只把「DB / 子账号能力快照」替换为 mock，保证「门店视角裁剪 + 锁定价 + 价格位隐藏」
 * 三条规则是在集成路径上被验证的（而不是各自的纯函数单测）。
 */
describe('MembershipRenewalService.listRenewalPlans', () => {
  /** 与 membership_plan_settings 表结构一致的行 */
  const PLAN_SETTING_ROWS = [
    {
      planId: 'monthly',
      planName: '月度会员',
      price: 4200,
      originalPrice: 10800,
      durationMonths: 1,
      validDays: null,
      updatedAt: new Date('2026-05-21T00:00:00.000Z'),
    },
    {
      planId: 'quarterly',
      planName: '季度会员',
      price: 10800,
      originalPrice: 29800,
      durationMonths: 3,
      validDays: null,
      updatedAt: new Date('2026-05-21T00:00:01.000Z'),
    },
    {
      planId: 'yearly',
      planName: '年度会员',
      price: 39800,
      originalPrice: 99800,
      durationMonths: 12,
      validDays: null,
      updatedAt: new Date('2026-05-21T00:00:02.000Z'),
    },
    {
      planId: 'lifetime',
      planName: '永久会员',
      price: 39800,
      originalPrice: null,
      durationMonths: null,
      validDays: 730,
      updatedAt: new Date('2026-05-21T00:00:03.000Z'),
    },
  ];

  const prismaService = {
    membershipPlanSetting: {
      findMany: jest.fn(),
      upsert: jest.fn(),
      aggregate: jest.fn(),
    },
    storeMembershipLockedPrice: {
      findMany: jest.fn(),
      aggregate: jest.fn(),
    },
  };

  const accessService = {
    getSubAccountBenefitSnapshot: jest.fn(),
  };

  const createService = (): MembershipRenewalService =>
    new MembershipRenewalService(
      prismaService as never,
      new StoreMembershipLockedPriceService(
        prismaService as never,
        accessService as unknown as PlatformMembershipAccessService,
      ),
    );

  /**
   * 构造子账号能力快照。
   *
   * `quota` 是**实时**配额（会员到期后会被 `normalizeSubAccountQuota` 归零），
   * `rawQuota` 是会员档案里配置的额度。续费页的判据是「**曾**开通子账号功能」
   * （`featureOwned = rawQuota > 0`），到期不失效，故两者要区分开。
   */
  const subAccountSnapshot = (params: {
    level: 'free' | 'monthly' | 'quarterly' | 'yearly' | 'lifetime';
    /** 实时归一化配额；已到期的门店传 0 */
    quota: number;
    /** 档案里配置的额度，默认与 quota 相同 */
    rawQuota?: number;
    /** 档案里保留的原档位；到期后 level 为 free，此处仍是原档位 */
    previousLevel?: 'free' | 'monthly' | 'quarterly' | 'yearly' | 'lifetime';
    /** 是否曾开通子账号功能；默认 true */
    featureOwned?: boolean;
  }) => {
    const rawQuota = params.rawQuota ?? params.quota;

    return {
      level: params.level,
      eligible: params.level === 'yearly' || params.level === 'lifetime',
      quota: params.quota,
      quotaMax: 10,
      enabled: params.quota > 0,
      rawQuota,
      featureOwned: rawQuota > 0,
      previousLevel: params.previousLevel ?? params.level,
    };
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prismaService.membershipPlanSetting.findMany.mockResolvedValue(
      PLAN_SETTING_ROWS,
    );
    prismaService.membershipPlanSetting.upsert.mockResolvedValue(
      PLAN_SETTING_ROWS[0],
    );
    prismaService.storeMembershipLockedPrice.findMany.mockResolvedValue([]);
    accessService.getSubAccountBenefitSnapshot.mockResolvedValue(
      subAccountSnapshot({ level: 'free', quota: 0 }),
    );
  });

  it('未开通子账号功能：返回月 / 季 / 年三档，价格为配置价且不带锁定价标记', async () => {
    const plans = await createService().listRenewalPlans(18);

    expect(plans.map((plan) => plan.id)).toEqual([
      'monthly',
      'quarterly',
      'yearly',
    ]);
    expect(plans.find((plan) => plan.id === 'yearly')).toMatchObject({
      name: '年度会员',
      price: 39800,
      originalPrice: 99800,
      monthlyPrice: 3316,
      // 无议定价、无子账号加价时实付价 == 配置价，角标即「配置划线价 − 配置价」
      badge: '省600元',
    });
    for (const plan of plans) {
      expect(plan.lockedPrice).toBeUndefined();
      expect(plan.hideOriginalPrice).toBeUndefined();
      expect(plan.hideMonthlyPrice).toBeUndefined();
      // 未开通子账号：不出现子账号数量，价格位仍展示划线原价
      expect(plan.subAccountIncludedCount).toBeUndefined();
    }
  });

  /**
   * 回归：Pulse「会员续费价格」改过议定价后，角标必须跟着**实付价**走。
   *
   * 角标曾经沿用套餐目录里按**配置价**算出的 badge，于是卡片上出现
   * 「划线 ¥298 / 实付 ¥112 / 省190元」这种自相矛盾的展示
   * （190 = 298 − 108 配置价，而 298 − 112 = 186）。
   */
  it('命中议定价时：角标按最终实付价重算，与卡片大价格一致', async () => {
    prismaService.storeMembershipLockedPrice.findMany.mockResolvedValue([
      // 成交价只记账，实际下发价取「配置价与议定价的较高者」
      { planId: 'quarterly', price: 9900, renewalPriceOverride: 11200 },
      { planId: 'yearly', price: 36900, renewalPriceOverride: 40500 },
    ]);

    const plans = await createService().listRenewalPlans(18);

    // 298 − 112 = 186（而不是按配置价 108 算出的 190）
    expect(plans.find((plan) => plan.id === 'quarterly')).toMatchObject({
      price: 11200,
      originalPrice: 29800,
      badge: '省186元',
    });
    // 998 − 405 = 593（而不是按配置价 398 算出的 600）
    expect(plans.find((plan) => plan.id === 'yearly')).toMatchObject({
      price: 40500,
      originalPrice: 99800,
      badge: '省593元',
    });
  });

  it('已开通子账号功能的年度会员：只返回年度卡，价格 = 后台配置价（成交价不参与）', async () => {
    accessService.getSubAccountBenefitSnapshot.mockResolvedValue(
      subAccountSnapshot({ level: 'yearly', quota: 2 }),
    );
    // 成交价 58800 只作记账，不参与续费定价
    prismaService.storeMembershipLockedPrice.findMany.mockResolvedValue([
      { planId: 'yearly', price: 58800 },
    ]);

    const plans = await createService().listRenewalPlans(18);

    expect(plans.map((plan) => plan.id)).toEqual(['yearly']);
    expect(plans[0]).toMatchObject({
      name: '年度会员',
      price: 39800,
      // 价格已含子账号权益，配置原价（不含子账号的旧价）不再下发
      originalPrice: null,
      subAccountIncludedCount: 2,
      // 39800 / 12 = 3316，月均价与展示价同源
      monthlyPrice: 3316,
    });
    // 划线原价不下发时没有可对比的基准，角标必须一并不下发
    expect('badge' in plans[0]).toBe(false);
  });

  it('已开通子账号功能的永久会员：只返回 AGES 卡，隐藏划线价与月均价', async () => {
    accessService.getSubAccountBenefitSnapshot.mockResolvedValue(
      subAccountSnapshot({ level: 'lifetime', quota: 2 }),
    );
    prismaService.storeMembershipLockedPrice.findMany.mockResolvedValue([
      { planId: 'lifetime', price: 59800 },
    ]);

    const plans = await createService().listRenewalPlans(18);

    expect(plans.map((plan) => plan.id)).toEqual(['lifetime']);
    expect(plans[0]).toMatchObject({
      name: 'AGES会员',
      // 永久配置价；成交价 59800 只记账，不参与定价
      price: 39800,
      originalPrice: null,
      durationMonths: null,
      validDays: 730,
      hideOriginalPrice: true,
      hideMonthlyPrice: true,
      subAccountIncludedCount: 2,
    });
    // 月均价字段整体不出现，避免前端拿到 config 折算值误渲染
    expect('monthlyPrice' in plans[0]).toBe(false);
  });

  it('已开通子账号功能但未锁价：回落配置价且不带锁定价标记', async () => {
    accessService.getSubAccountBenefitSnapshot.mockResolvedValue(
      subAccountSnapshot({ level: 'yearly', quota: 2 }),
    );

    const plans = await createService().listRenewalPlans(18);

    expect(plans.map((plan) => plan.id)).toEqual(['yearly']);
    expect(plans[0]).toMatchObject({ price: 39800 });
    expect(plans[0].lockedPrice).toBeUndefined();
    // 子账号数量不依赖锁定价：只要开通了子账号功能就下发
    expect(plans[0].subAccountIncludedCount).toBe(2);
  });

  it('仅在设置会员等级时录了子账号加价（未单独设置配额）：同样只返回年 / 永久卡', async () => {
    // featureOwned=false（pulseSubAccountQuota=0），但快照里有年卡子账号加价
    accessService.getSubAccountBenefitSnapshot.mockResolvedValue(
      subAccountSnapshot({
        level: 'yearly',
        quota: 0,
        featureOwned: false,
        previousLevel: 'yearly',
      }),
    );
    prismaService.storeMembershipLockedPrice.findMany.mockResolvedValue([
      {
        planId: 'yearly',
        price: 49800,
        subAccountAmount: 10000,
        subAccountCount: 2,
      },
    ]);

    const plans = await createService().listRenewalPlans(18);

    // 判据与价格里的子账号加价同源：否则年度卡标着「包含 2 个子账号」
    // 却还能买月 / 季，月均比例直接倒挂
    expect(plans.map((plan) => plan.id)).toEqual(['yearly']);
    // 39800 + 10000 = 49800
    expect(plans[0]).toMatchObject({ price: 49800 });
  });

  it('成交价不参与定价：高于配置价的成交记录也按配置价下发', async () => {
    prismaService.storeMembershipLockedPrice.findMany.mockResolvedValue([
      { planId: 'yearly', price: 58800 },
      { planId: 'monthly', price: 1000 },
    ]);

    const plans = await createService().listRenewalPlans(18);

    // 档位裁剪仍由「是否曾开通子账号」决定：未开通 → 月 / 季 / 年三档全给
    expect(plans.map((plan) => plan.id)).toEqual([
      'monthly',
      'quarterly',
      'yearly',
    ]);
    // 定价一律按配置价：成交价 58800 只记账，不托住续费价
    expect(plans.find((plan) => plan.id === 'yearly')).toMatchObject({
      price: 39800,
    });
    const monthlyPlan = plans.find((plan) => plan.id === 'monthly');
    expect(monthlyPlan).toMatchObject({ price: 4200 });
    expect(monthlyPlan?.lockedPrice).toBeUndefined();
  });

  it('已开通子账号功能但档位为月 / 季脏数据：按年度兜底，避免返回空或降级档位', async () => {
    accessService.getSubAccountBenefitSnapshot.mockResolvedValue(
      subAccountSnapshot({ level: 'monthly', quota: 3 }),
    );

    const plans = await createService().listRenewalPlans(18);

    expect(plans.map((plan) => plan.id)).toEqual(['yearly']);
  });

  it('续费卡的子账号数量优先用成交时录入的数量，与收费口径保持同源', async () => {
    accessService.getSubAccountBenefitSnapshot.mockResolvedValue(
      subAccountSnapshot({ level: 'yearly', quota: 8 }),
    );
    prismaService.storeMembershipLockedPrice.findMany.mockResolvedValue([
      {
        planId: 'yearly',
        price: 54800,
        subAccountAmount: 15000,
        subAccountCount: 3,
      },
    ]);

    const plans = await createService().listRenewalPlans(18);

    // 实时配额是 8，但价格是按 3 个子账号算出来的 → 展示必须跟账单一致
    expect(plans[0]).toMatchObject({ subAccountIncludedCount: 3 });
  });

  it('已开通子账号功能且配额为 0：视为未开通，返回月 / 季 / 年三档', async () => {
    accessService.getSubAccountBenefitSnapshot.mockResolvedValue(
      subAccountSnapshot({ level: 'yearly', quota: 0 }),
    );

    const plans = await createService().listRenewalPlans(18);

    expect(plans.map((plan) => plan.id)).toEqual([
      'monthly',
      'quarterly',
      'yearly',
    ]);
  });

  it('月均价按实付价（配置价 + 子账号加价）折算，避免与展示价自相矛盾', async () => {
    accessService.getSubAccountBenefitSnapshot.mockResolvedValue(
      subAccountSnapshot({ level: 'yearly', quota: 2 }),
    );
    // 子账号加价 15000 参与定价；成交价 50000 只记账
    prismaService.storeMembershipLockedPrice.findMany.mockResolvedValue([
      {
        planId: 'yearly',
        price: 50000,
        subAccountAmount: 15000,
        subAccountCount: 2,
      },
    ]);

    const plans = await createService().listRenewalPlans(18);

    expect(plans[0]).toMatchObject({
      // 39800 + 15000 = 54800
      price: 54800,
      // 54800 / 12 = 4566，与卡片大价格同源
      monthlyPrice: 4566,
    });
  });

  it('成交价低于标准总价时按标准总价下发，且不打锁价标记', async () => {
    accessService.getSubAccountBenefitSnapshot.mockResolvedValue(
      subAccountSnapshot({ level: 'yearly', quota: 2 }),
    );
    // 配置价已涨到 36900，客户当年只成交了 30000 → 按当前标准价结算
    prismaService.storeMembershipLockedPrice.findMany.mockResolvedValue([
      { planId: 'yearly', price: 30000 },
    ]);

    const plans = await createService().listRenewalPlans(18);

    expect(plans[0]).toMatchObject({ price: 39800 });
    expect(plans[0].lockedPrice).toBeUndefined();
  });

  it('含子账号的续费卡：价格位改下发子账号数量，不再给划线原价', async () => {
    accessService.getSubAccountBenefitSnapshot.mockResolvedValue(
      subAccountSnapshot({ level: 'yearly', quota: 5 }),
    );
    prismaService.storeMembershipLockedPrice.findMany.mockResolvedValue([
      { planId: 'yearly', price: 49800 },
    ]);

    const plans = await createService().listRenewalPlans(18);

    expect(plans[0]).toMatchObject({
      // 成交价 49800 不参与定价，按配置价 39800 下发
      price: 39800,
      // 配置价 99800 是「不含子账号」的旧价，划掉它会被读成「续费反而涨价」
      originalPrice: null,
      subAccountIncludedCount: 5,
      // 39800 / 12 = 3316，与卡片大价格同源
      monthlyPrice: 3316,
    });
    expect('hideOriginalPrice' in plans[0]).toBe(false);
  });

  it('年度会员到期后：仍只返回年度卡，并按配置价展示（不回落成三档）', async () => {
    // 到期后实时档位回落为 free、实时配额归零，但档案里保留原档位与配置额度
    accessService.getSubAccountBenefitSnapshot.mockResolvedValue(
      subAccountSnapshot({
        level: 'free',
        quota: 0,
        rawQuota: 8,
        previousLevel: 'yearly',
      }),
    );
    prismaService.storeMembershipLockedPrice.findMany.mockResolvedValue([
      { planId: 'yearly', price: 58800 },
    ]);

    const plans = await createService().listRenewalPlans(18);

    expect(plans.map((plan) => plan.id)).toEqual(['yearly']);
    expect(plans[0]).toMatchObject({
      name: '年度会员',
      // 配置价；成交价 58800 只记账
      price: 39800,
      // 价格已含子账号权益：不下发划线原价，改下发配置额度
      originalPrice: null,
      subAccountIncludedCount: 8,
      monthlyPrice: 3316,
    });
  });

  it('AGES（永久）会员到期后：仍只返回 AGES 卡，并按配置价展示', async () => {
    accessService.getSubAccountBenefitSnapshot.mockResolvedValue(
      subAccountSnapshot({
        level: 'free',
        quota: 0,
        rawQuota: 8,
        previousLevel: 'lifetime',
      }),
    );
    prismaService.storeMembershipLockedPrice.findMany.mockResolvedValue([
      { planId: 'lifetime', price: 59800 },
    ]);

    const plans = await createService().listRenewalPlans(18);

    expect(plans.map((plan) => plan.id)).toEqual(['lifetime']);
    expect(plans[0]).toMatchObject({
      name: 'AGES会员',
      // 永久配置价；成交价 59800 只记账
      price: 39800,
      originalPrice: null,
      hideOriginalPrice: true,
      hideMonthlyPrice: true,
      subAccountIncludedCount: 8,
    });
  });

  it('从未开通子账号功能的到期门店：仍返回月 / 季 / 年三档（不误伤）', async () => {
    accessService.getSubAccountBenefitSnapshot.mockResolvedValue(
      subAccountSnapshot({
        level: 'free',
        quota: 0,
        rawQuota: 0,
        previousLevel: 'yearly',
      }),
    );

    const plans = await createService().listRenewalPlans(18);

    expect(plans.map((plan) => plan.id)).toEqual([
      'monthly',
      'quarterly',
      'yearly',
    ]);
  });

  describe('getPricingVersion', () => {
    const CONFIG_UPDATED_AT = new Date('2026-05-21T00:00:03.000Z');
    const STORE_UPDATED_AT = new Date('2026-06-01T00:00:00.000Z');

    const mockVersions = (params: {
      configUpdatedAt?: Date | null;
      storeUpdatedAt?: Date | null;
    }) => {
      prismaService.membershipPlanSetting.aggregate.mockResolvedValue({
        _max: { updatedAt: params.configUpdatedAt ?? null },
      });
      prismaService.storeMembershipLockedPrice.aggregate.mockResolvedValue({
        _max: { updatedAt: params.storeUpdatedAt ?? null },
      });
    };

    it('取「全局配置价」与「本门店成交价快照」两者的较大变更时间', async () => {
      mockVersions({
        configUpdatedAt: CONFIG_UPDATED_AT,
        storeUpdatedAt: null,
      });
      await expect(createService().getPricingVersion(18)).resolves.toBe(
        CONFIG_UPDATED_AT.getTime() + MEMBERSHIP_PLAN_PRESENTATION_VERSION,
      );

      // 门店议价 / 子账号加价改得比平台配置更晚时按门店时间
      mockVersions({
        configUpdatedAt: CONFIG_UPDATED_AT,
        storeUpdatedAt: STORE_UPDATED_AT,
      });
      await expect(createService().getPricingVersion(18)).resolves.toBe(
        STORE_UPDATED_AT.getTime() + MEMBERSHIP_PLAN_PRESENTATION_VERSION,
      );
    });

    /**
     * 回归：主推位（`PLAN_RECOMMEND_CONFIG`）这类配置**不落库**，改代码不会动
     * 任何 `updatedAt`。版本号必须显式叠加代码级展示口径版本，否则部署后商家端
     * 在同一次会话里会一直命中本地缓存，「推荐」标签还挂在旧的档位上。
     */
    it('叠加代码级展示口径版本：不下库的配置改了也要能刷新缓存', async () => {
      expect(MEMBERSHIP_PLAN_PRESENTATION_VERSION).toBeGreaterThan(0);

      mockVersions({
        configUpdatedAt: CONFIG_UPDATED_AT,
        storeUpdatedAt: null,
      });

      const version = await createService().getPricingVersion(18);

      // 数据一点没变，版本号也必须比纯时间戳大 —— 差值即代码版本
      expect(version - CONFIG_UPDATED_AT.getTime()).toBe(
        MEMBERSHIP_PLAN_PRESENTATION_VERSION,
      );
    });

    /**
     * 版本号由展示配置哈希算出，因此「改了配置」本身就等于「版本号变了」，
     * 不依赖任何人记得去 +1 —— 人工计数器漏改一次，缓存就刷不掉。
     */
    it('展示口径一改版本号就自动变（无需人工维护计数器）', () => {
      const signature = buildPlanPresentationSignature();

      expect(computePresentationVersion(signature)).toBe(
        MEMBERSHIP_PLAN_PRESENTATION_VERSION,
      );

      // 把主推位挪回季度：与「挪到年度」那次改动必须算出不同的版本号
      const movedRecommend = {
        ...signature,
        recommended: {
          ...signature.recommended,
          quarterly: { recommended: true },
          yearly: {},
        },
      };
      expect(computePresentationVersion(movedRecommend)).not.toBe(
        MEMBERSHIP_PLAN_PRESENTATION_VERSION,
      );

      // 默认配置价改了同样要变
      const changedDefaults = {
        ...signature,
        defaults: {
          ...signature.defaults,
          yearly: { ...signature.defaults.yearly, price: 43800 },
        },
      };
      expect(computePresentationVersion(changedDefaults)).not.toBe(
        MEMBERSHIP_PLAN_PRESENTATION_VERSION,
      );
    });

    it('两侧都没有数据时仍返回可用的版本号', async () => {
      mockVersions({});

      await expect(createService().getPricingVersion(18)).resolves.toBe(
        MEMBERSHIP_PLAN_PRESENTATION_VERSION,
      );
    });
  });
});
