import { MembershipRenewalService } from './membership-renewal.service';
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
      price: 3800,
      originalPrice: 3800,
      durationMonths: 1,
      validDays: null,
      updatedAt: new Date('2026-05-21T00:00:00.000Z'),
    },
    {
      planId: 'quarterly',
      planName: '季度会员',
      price: 9900,
      originalPrice: 11400,
      durationMonths: 3,
      validDays: null,
      updatedAt: new Date('2026-05-21T00:00:01.000Z'),
    },
    {
      planId: 'yearly',
      planName: '年度会员',
      price: 36900,
      originalPrice: 45600,
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
    },
    storeMembershipLockedPrice: {
      findMany: jest.fn(),
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
      price: 36900,
      originalPrice: 45600,
      monthlyPrice: 3075,
    });
    for (const plan of plans) {
      expect(plan.lockedPrice).toBeUndefined();
      expect(plan.hideOriginalPrice).toBeUndefined();
      expect(plan.hideMonthlyPrice).toBeUndefined();
      // 未开通子账号：不出现子账号数量，价格位仍展示划线原价
      expect(plan.subAccountIncludedCount).toBeUndefined();
    }
  });

  it('已开通子账号功能的年度会员：只返回年度卡，且命中首购锁定价', async () => {
    accessService.getSubAccountBenefitSnapshot.mockResolvedValue(
      subAccountSnapshot({ level: 'yearly', quota: 2 }),
    );
    prismaService.storeMembershipLockedPrice.findMany.mockResolvedValue([
      { planId: 'yearly', price: 58800 },
    ]);

    const plans = await createService().listRenewalPlans(18);

    expect(plans.map((plan) => plan.id)).toEqual(['yearly']);
    expect(plans[0]).toMatchObject({
      name: '年度会员',
      price: 58800,
      // 价格已含子账号权益，配置原价（不含子账号的旧价）不再下发
      originalPrice: null,
      subAccountIncludedCount: 2,
      // 58800 / 12 = 4900，按月均价与大价格同源
      monthlyPrice: 4900,
      lockedPrice: true,
    });
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
      price: 59800,
      originalPrice: null,
      durationMonths: null,
      validDays: 730,
      hideOriginalPrice: true,
      hideMonthlyPrice: true,
      lockedPrice: true,
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
    expect(plans[0]).toMatchObject({ price: 36900 });
    expect(plans[0].lockedPrice).toBeUndefined();
    // 子账号数量不依赖锁定价：只要开通了子账号功能就下发
    expect(plans[0].subAccountIncludedCount).toBe(2);
  });

  it('未开通子账号功能时即使存在锁定价快照也按配置价下发（锁定价不生效）', async () => {
    prismaService.storeMembershipLockedPrice.findMany.mockResolvedValue([
      { planId: 'yearly', price: 58800 },
      { planId: 'monthly', price: 1000 },
    ]);

    const plans = await createService().listRenewalPlans(18);

    expect(plans.map((plan) => plan.id)).toEqual([
      'monthly',
      'quarterly',
      'yearly',
    ]);
    expect(plans.find((plan) => plan.id === 'yearly')).toMatchObject({
      price: 36900,
    });
    for (const plan of plans) {
      expect(plan.lockedPrice).toBeUndefined();
    }
  });

  it('已开通子账号功能但档位为月 / 季脏数据：按年度兜底，避免返回空或降级档位', async () => {
    accessService.getSubAccountBenefitSnapshot.mockResolvedValue(
      subAccountSnapshot({ level: 'monthly', quota: 3 }),
    );

    const plans = await createService().listRenewalPlans(18);

    expect(plans.map((plan) => plan.id)).toEqual(['yearly']);
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

  it('命中锁定价时月均价按实付锁定价折算，避免与展示价自相矛盾', async () => {
    accessService.getSubAccountBenefitSnapshot.mockResolvedValue(
      subAccountSnapshot({ level: 'yearly', quota: 2 }),
    );
    prismaService.storeMembershipLockedPrice.findMany.mockResolvedValue([
      { planId: 'yearly', price: 30000 },
    ]);

    const plans = await createService().listRenewalPlans(18);

    expect(plans[0]).toMatchObject({
      price: 30000,
      lockedPrice: true,
      // 30000 / 12 = 2500（按实付价折算），不是配置价折算的 3075
      monthlyPrice: 2500,
    });
  });

  it('含子账号的续费卡：价格位改下发子账号数量，不再给划线原价', async () => {
    accessService.getSubAccountBenefitSnapshot.mockResolvedValue(
      subAccountSnapshot({ level: 'yearly', quota: 5 }),
    );
    prismaService.storeMembershipLockedPrice.findMany.mockResolvedValue([
      { planId: 'yearly', price: 46900 },
    ]);

    const plans = await createService().listRenewalPlans(18);

    expect(plans[0]).toMatchObject({
      price: 46900,
      // 配置价 45600 是「不含子账号」的旧价，划掉它会被读成「续费反而涨价」
      originalPrice: null,
      subAccountIncludedCount: 5,
      // 46900 / 12 = 3908，与卡片大价格同源
      monthlyPrice: 3908,
      lockedPrice: true,
    });
    expect('hideOriginalPrice' in plans[0]).toBe(false);
  });

  it('年度会员到期后：仍只返回年度卡，并按首购锁定价展示（不回落成三档）', async () => {
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
      // 首次成交价，而不是涨过价的配置价 36900
      price: 58800,
      lockedPrice: true,
      // 价格已含子账号权益：不下发划线原价，改下发配置额度
      originalPrice: null,
      subAccountIncludedCount: 8,
      monthlyPrice: 4900,
    });
  });

  it('AGES（永久）会员到期后：仍只返回 AGES 卡，并按首购锁定价展示', async () => {
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
      price: 59800,
      originalPrice: null,
      hideOriginalPrice: true,
      hideMonthlyPrice: true,
      lockedPrice: true,
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
});
