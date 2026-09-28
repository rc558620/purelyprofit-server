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
      price: 36900,
      // 价格已含子账号权益，配置原价（不含子账号的旧价）不再下发
      originalPrice: null,
      subAccountIncludedCount: 2,
      // 36900 / 12 = 3075，月均价与展示价同源
      monthlyPrice: 3075,
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
    expect(plans[0]).toMatchObject({ price: 36900 });
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
    // 36900 + 10000 = 46900
    expect(plans[0]).toMatchObject({ price: 46900 });
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
      price: 36900,
    });
    const monthlyPlan = plans.find((plan) => plan.id === 'monthly');
    expect(monthlyPlan).toMatchObject({ price: 3800 });
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
        price: 51900,
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
      // 36900 + 15000 = 51900
      price: 51900,
      // 51900 / 12 = 4325，与卡片大价格同源
      monthlyPrice: 4325,
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

    expect(plans[0]).toMatchObject({ price: 36900 });
    expect(plans[0].lockedPrice).toBeUndefined();
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
      // 成交价 46900 不参与定价，按配置价 36900 下发
      price: 36900,
      // 配置价 45600 是「不含子账号」的旧价，划掉它会被读成「续费反而涨价」
      originalPrice: null,
      subAccountIncludedCount: 5,
      // 36900 / 12 = 3075，与卡片大价格同源
      monthlyPrice: 3075,
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
      price: 36900,
      // 价格已含子账号权益：不下发划线原价，改下发配置额度
      originalPrice: null,
      subAccountIncludedCount: 8,
      monthlyPrice: 3075,
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
});
