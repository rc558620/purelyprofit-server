import { BadRequestException } from '@nestjs/common';
import { PulseMembershipAdminMembershipMutationService } from './membership-admin-membership-mutation.service';
import type { PulseAdminMembershipProfileRecord } from './membership.types';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';

/**
 * 管理端设置会员等级的档位落盘规则：「只升不降」。
 *
 * 这是为了防止一个死局：开了子账号的门店一旦被降到月度 / 季度，续费页会因为
 * `resolveVisibleRenewalPlanIds` 只下发年度 / 永久卡，而按月度下单又会被
 * `assertRenewalPlanAllowed` 以 409 拒绝——客户既升不上去，也续不了当期。
 * 因此所选档位低于当前档位时默认只追加时长、保持档位，真要降档必须显式确认。
 */
describe('PulseMembershipAdminMembershipMutationService.resolveWritablePlanId', () => {
  const DAY_MS = 86_400_000;

  // 纯函数，只吃入参，不触碰任何依赖；构造参数传空即可
  const service = new PulseMembershipAdminMembershipMutationService(
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
  );

  const buildProfile = (
    overrides: Partial<PulseAdminMembershipProfileRecord> = {},
  ): PulseAdminMembershipProfileRecord =>
    ({
      id: 1,
      storeId: 18,
      currentPlanId: 'yearly',
      previousPlanId: null,
      startsAt: new Date(Date.now() - 100 * DAY_MS),
      expiresAt: new Date(Date.now() + 30 * DAY_MS),
      ...overrides,
    }) as PulseAdminMembershipProfileRecord;

  it('有效期内选更低档位：保持原档位（等价于赠送时长）', () => {
    const result = service.resolveWritablePlanId({
      profile: buildProfile({ currentPlanId: 'yearly' }),
      targetPlanId: 'monthly',
      dto: { level: 'monthly' },
    });

    expect(result).toBe('yearly');
  });

  it('有效期内选更低档位但显式确认降档：按目标档位落地', () => {
    const result = service.resolveWritablePlanId({
      profile: buildProfile({ currentPlanId: 'yearly' }),
      targetPlanId: 'monthly',
      dto: { level: 'monthly', confirmDowngradePlan: true },
    });

    expect(result).toBe('monthly');
  });

  it('有效期内选更高档位：正常升级', () => {
    const result = service.resolveWritablePlanId({
      profile: buildProfile({ currentPlanId: 'yearly' }),
      targetPlanId: 'lifetime',
      dto: { level: 'lifetime' },
    });

    expect(result).toBe('lifetime');
  });

  it('有效期内选同档位：原样落盘（此时才允许写入成交价）', () => {
    const result = service.resolveWritablePlanId({
      profile: buildProfile({ currentPlanId: 'yearly' }),
      targetPlanId: 'yearly',
      dto: { level: 'annual', priceDisplay: '650' },
    });

    expect(result).toBe('yearly');
  });

  it('会员已过期时不受「只升不降」限制（等同于重新开通）', () => {
    const result = service.resolveWritablePlanId({
      profile: buildProfile({
        currentPlanId: 'yearly',
        expiresAt: new Date(Date.now() - DAY_MS),
      }),
      targetPlanId: 'monthly',
      dto: { level: 'monthly' },
    });

    expect(result).toBe('monthly');
  });

  it('当前为免费会员时直接采用目标档位', () => {
    const result = service.resolveWritablePlanId({
      profile: buildProfile({
        currentPlanId: null,
        previousPlanId: 'yearly',
        expiresAt: null,
      }),
      targetPlanId: 'monthly',
      dto: { level: 'monthly' },
    });

    expect(result).toBe('monthly');
  });

  it('目标为免费会员时返回 null', () => {
    const result = service.resolveWritablePlanId({
      profile: buildProfile({ currentPlanId: 'yearly' }),
      targetPlanId: null,
      dto: { level: 'free', confirmDowngradeToFree: true },
    });

    expect(result).toBeNull();
  });
});

/**
 * 设置会员等级弹窗里填了子账号数量 = 明确开通子账号能力：
 * 必须同步设置配额（pulseSubAccountQuota），否则商家端没有可分配的
 * 子账号槽位，「续费价含子账号」与「实际能用子账号」就会脱节。
 */
describe('PulseMembershipAdminMembershipMutationService.applyAdminMembershipLevel 的子账号配额同步', () => {
  const storeSubAccountService = { updateQuota: jest.fn() };
  const prismaService = {
    storeMembershipProfile: { upsert: jest.fn() },
    storeMembershipOrder: { create: jest.fn() },
    $transaction: jest.fn(),
  };
  // 档案 / 额度 / 成交价快照在同一事务里写：事务客户端复用同一份桩
  prismaService.$transaction.mockImplementation(
    (callback: (tx: unknown) => unknown) => callback(prismaService),
  );
  const mutationStateService = {
    loadAdminMemberStateOrThrow: jest.fn(),
    invalidateAdminMemberDerived: jest.fn(),
  };
  const quotaService = { grantByPlan: jest.fn(), clear: jest.fn() };
  const lockedPriceService = { upsertDealPrice: jest.fn() };
  const platformMembershipService = {
    getPlanConfig: jest.fn().mockResolvedValue({
      id: 'yearly',
      name: '年度会员',
      price: 39800,
      originalPrice: 45600,
      durationMonths: 12,
      validDays: 365,
    }),
  };

  const createService = () =>
    new PulseMembershipAdminMembershipMutationService(
      platformMembershipService as never,
      prismaService as never,
      lockedPriceService as never,
      mutationStateService as never,
      quotaService as never,
      storeSubAccountService as never,
    );

  const user = { id: 1, email: 'op@x.com' } as AuthenticatedUser;

  beforeEach(() => {
    jest.clearAllMocks();
    mutationStateService.loadAdminMemberStateOrThrow.mockResolvedValue({
      profile: {
        currentPlanId: 'yearly',
        previousPlanId: null,
        startsAt: new Date('2026-01-01'),
        expiresAt: new Date(Date.now() + 100 * 24 * 60 * 60 * 1000),
        totalPoints: 0,
        availablePoints: 0,
        subAccountQuota: 0,
        pulseSubAccountQuota: 0,
      } satisfies PulseAdminMembershipProfileRecord,
    });
    prismaService.storeMembershipProfile.upsert.mockResolvedValue({});
    mutationStateService.invalidateAdminMemberDerived.mockResolvedValue(
      undefined,
    );
    quotaService.grantByPlan.mockResolvedValue(undefined);
    lockedPriceService.upsertDealPrice.mockResolvedValue(undefined);
  });

  const run = (dto: Record<string, unknown>) =>
    createService().applyAdminMembershipLevel(user, 18, dto as never);

  it('年卡 + 子账号数量 2：同步设置配额为 2', async () => {
    await run({
      level: 'annual',
      membershipExpiry: '2027-12-31T00:00:00.000Z',
      priceDisplay: '498',
      subAccountCount: 2,
      subAccountAmountDisplay: '100',
    });

    expect(storeSubAccountService.updateQuota).toHaveBeenCalledWith(
      18,
      2,
      1,
      '设置会员等级时同步开通子账号',
    );
  });

  it('未填子账号数量：不动配额', async () => {
    await run({
      level: 'annual',
      membershipExpiry: '2027-12-31T00:00:00.000Z',
      priceDisplay: '398',
    });

    expect(storeSubAccountService.updateQuota).not.toHaveBeenCalled();
  });

  it('月度档位：开不了子账号，即便带了数量也不设置配额', async () => {
    await run({
      level: 'monthly',
      membershipExpiry: '2027-12-31T00:00:00.000Z',
      priceDisplay: '42',
      subAccountCount: 2,
    });

    expect(storeSubAccountService.updateQuota).not.toHaveBeenCalled();
  });
});

/**
 * 设置会员等级要落一条会员订单，供两处消费：
 *   1. 营收统计（勾了「计入收入」才算，赠送必须被排除）
 *   2. 会员详情页「设置会员等级记录」tab
 *
 * 落单失败不得回滚已完成的档位变更——档案、额度、子账号都已写库，抛出去只会
 * 让运营重试，反而重复改档。
 */
describe('PulseMembershipAdminMembershipMutationService.applyAdminMembershipLevel 的订单落盘', () => {
  const PLAN_CONFIGS = {
    monthly: {
      id: 'monthly',
      name: '月度会员',
      price: 3800,
      originalPrice: 3800,
      durationMonths: 1,
      validDays: 30,
    },
    yearly: {
      id: 'yearly',
      name: '年度会员',
      price: 39800,
      originalPrice: 45600,
      durationMonths: 12,
      validDays: 365,
    },
  } as const;

  const storeSubAccountService = { updateQuota: jest.fn() };
  const prismaService = {
    storeMembershipProfile: { upsert: jest.fn() },
    storeMembershipOrder: { create: jest.fn() },
    $transaction: jest.fn(),
  };
  // 档案 / 额度 / 成交价快照在同一事务里写：事务客户端复用同一份桩
  prismaService.$transaction.mockImplementation(
    (callback: (tx: unknown) => unknown) => callback(prismaService),
  );
  const mutationStateService = {
    loadAdminMemberStateOrThrow: jest.fn(),
    invalidateAdminMemberDerived: jest.fn(),
  };
  const quotaService = { grantByPlan: jest.fn(), clear: jest.fn() };
  const lockedPriceService = { upsertDealPrice: jest.fn() };
  const platformMembershipService = { getPlanConfig: jest.fn() };

  const createService = () =>
    new PulseMembershipAdminMembershipMutationService(
      platformMembershipService as never,
      prismaService as never,
      lockedPriceService as never,
      mutationStateService as never,
      quotaService as never,
      storeSubAccountService as never,
    );

  const user = { id: 1, email: 'op@x.com' } as AuthenticatedUser;

  const stubProfile = (
    overrides: Partial<PulseAdminMembershipProfileRecord> = {},
  ): void => {
    mutationStateService.loadAdminMemberStateOrThrow.mockResolvedValue({
      profile: {
        currentPlanId: 'yearly',
        previousPlanId: null,
        startsAt: new Date('2026-01-01'),
        expiresAt: new Date(Date.now() + 100 * 24 * 60 * 60 * 1000),
        totalPoints: 0,
        availablePoints: 0,
        subAccountQuota: 0,
        pulseSubAccountQuota: 0,
        ...overrides,
      } satisfies PulseAdminMembershipProfileRecord,
    });
  };

  beforeEach(() => {
    jest.clearAllMocks();
    stubProfile();
    // profileId 取自 upsert 返回值，桩里必须给 id
    prismaService.storeMembershipProfile.upsert.mockResolvedValue({ id: 77 });
    mutationStateService.invalidateAdminMemberDerived.mockResolvedValue(
      undefined,
    );
    quotaService.grantByPlan.mockResolvedValue(undefined);
    quotaService.clear.mockResolvedValue(undefined);
    lockedPriceService.upsertDealPrice.mockResolvedValue(undefined);
    prismaService.storeMembershipOrder.create.mockResolvedValue({ id: 900 });
    platformMembershipService.getPlanConfig.mockImplementation(
      (planId: string) =>
        Promise.resolve(
          PLAN_CONFIGS[planId as keyof typeof PLAN_CONFIGS] ??
            PLAN_CONFIGS.yearly,
        ),
    );
  });

  const run = (dto: Record<string, unknown>) =>
    createService().applyAdminMembershipLevel(user, 18, dto as never);

  it('勾选计入收入：落 admin 订单，金额取成交价', async () => {
    await run({
      level: 'annual',
      membershipExpiry: '2027-12-31T00:00:00.000Z',
      priceDisplay: '498',
      countAsIncome: true,
    });

    expect(prismaService.storeMembershipOrder.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        storeId: 18,
        profileId: 77,
        planId: 'yearly',
        amount: 49800,
        status: 'paid',
        paymentChannel: 'admin',
      }),
    });
  });

  it('未勾选：落 gift 订单，金额 0（营收统计已排除 gift）', async () => {
    await run({
      level: 'annual',
      membershipExpiry: '2027-12-31T00:00:00.000Z',
      priceDisplay: '498',
      countAsIncome: false,
    });

    expect(prismaService.storeMembershipOrder.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        planId: 'yearly',
        amount: 0,
        paymentChannel: 'gift',
      }),
    });
  });

  it('不传 countAsIncome：按赠送处理，不会误判为计入收入', async () => {
    await run({
      level: 'annual',
      membershipExpiry: '2027-12-31T00:00:00.000Z',
      priceDisplay: '498',
    });

    expect(prismaService.storeMembershipOrder.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        amount: 0,
        paymentChannel: 'gift',
      }),
    });
  });

  it('月度档位勾选计入收入但未填价：金额回落配置价，不落 0', async () => {
    // 当前无有效档位才不会被「只升不降」抬回年度
    stubProfile({ currentPlanId: null, expiresAt: null });

    await run({
      level: 'monthly',
      membershipExpiry: '2027-12-31T00:00:00.000Z',
      countAsIncome: true,
    });

    expect(prismaService.storeMembershipOrder.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        planId: 'monthly',
        amount: PLAN_CONFIGS.monthly.price,
        paymentChannel: 'admin',
      }),
    });
  });

  it('被「只升不降」抬回档位：勾选计入收入仍按所选档位计入营收，且不写成交价快照', async () => {
    // 当前是有效期内的年度会员 → 选月度会被抬回年度、只追加时长。
    // 档位没动，但运营手上收的是月卡的钱，订单就该记月度：
    // 记成「卖了一套年度会员、营收 +398」才是凭空多出来的收入
    await run({
      level: 'monthly',
      membershipExpiry: '2027-12-31T00:00:00.000Z',
      countAsIncome: true,
    });

    expect(prismaService.storeMembershipOrder.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        planId: 'monthly',
        amount: PLAN_CONFIGS.monthly.price,
        paymentChannel: 'admin',
      }),
    });
    // 与订单不同口径：档位被抬回时不写成交价快照，避免临时金额污染续费价
    expect(lockedPriceService.upsertDealPrice).not.toHaveBeenCalled();
  });

  it('被「只升不降」抬回档位且未勾选：仍按赠送记录，金额 0', async () => {
    await run({
      level: 'monthly',
      membershipExpiry: '2027-12-31T00:00:00.000Z',
      countAsIncome: false,
    });

    expect(prismaService.storeMembershipOrder.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        planId: 'monthly',
        amount: 0,
        paymentChannel: 'gift',
      }),
    });
  });

  it('勾选计入收入但所选档位配置价为 0：退回赠送，不虚增成交笔数', async () => {
    // 0 元落一笔 paid/admin 只会让「成交笔数 +1、营收 +0」，对账时是纯噪音
    platformMembershipService.getPlanConfig.mockImplementation(
      (planId: string) =>
        Promise.resolve(
          planId === 'monthly'
            ? { ...PLAN_CONFIGS.monthly, price: 0 }
            : (PLAN_CONFIGS[planId as keyof typeof PLAN_CONFIGS] ??
                PLAN_CONFIGS.yearly),
        ),
    );

    await run({
      level: 'monthly',
      membershipExpiry: '2027-12-31T00:00:00.000Z',
      countAsIncome: true,
    });

    expect(prismaService.storeMembershipOrder.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        amount: 0,
        paymentChannel: 'gift',
      }),
    });
  });

  it('降级为免费：不落订单', async () => {
    await run({ level: 'free', confirmDowngradeToFree: true });

    expect(prismaService.storeMembershipOrder.create).not.toHaveBeenCalled();
  });

  it('落单失败不阻断档位变更（避免运营重试导致重复改档）', async () => {
    prismaService.storeMembershipOrder.create.mockRejectedValue(
      new Error('db down'),
    );
    const service = createService();
    jest.spyOn(service['logger'], 'error').mockImplementation(() => undefined);

    await expect(
      service.applyAdminMembershipLevel(user, 18, {
        level: 'annual',
        membershipExpiry: '2027-12-31T00:00:00.000Z',
        priceDisplay: '498',
        countAsIncome: true,
      } as never),
    ).resolves.toBeUndefined();

    expect(prismaService.storeMembershipProfile.upsert).toHaveBeenCalled();
  });
});

/**
 * 新客额度赠送口径：按**所选档位** × **期数**叠加。
 *
 * 两处历史 bug 的回归防线：
 * ① 按落地档位（nextPlanId）发放——永久会员选月度会被「只升不降」抬回永久，送成 300；
 * ② 忽略期数——年度 × 2 只送 300，而弹窗与时长都按 730 天 / 600 位承诺。
 */
describe('PulseMembershipAdminMembershipMutationService.applyAdminMembershipLevel 的新客额度赠送', () => {
  const storeSubAccountService = { updateQuota: jest.fn() };
  const prismaService = {
    storeMembershipProfile: { upsert: jest.fn() },
    storeMembershipOrder: { create: jest.fn() },
    $transaction: jest.fn(),
  };
  // 档案 / 额度 / 成交价快照在同一事务里写：事务客户端复用同一份桩
  prismaService.$transaction.mockImplementation(
    (callback: (tx: unknown) => unknown) => callback(prismaService),
  );
  const mutationStateService = {
    loadAdminMemberStateOrThrow: jest.fn(),
    invalidateAdminMemberDerived: jest.fn(),
  };
  const quotaService = { grantByPlan: jest.fn(), clear: jest.fn() };
  const lockedPriceService = { upsertDealPrice: jest.fn() };
  const platformMembershipService = { getPlanConfig: jest.fn() };

  const createService = () =>
    new PulseMembershipAdminMembershipMutationService(
      platformMembershipService as never,
      prismaService as never,
      lockedPriceService as never,
      mutationStateService as never,
      quotaService as never,
      storeSubAccountService as never,
    );

  const user = { id: 1, email: 'op@x.com' } as AuthenticatedUser;

  /** 桩：当前无有效档位（不会被「只升不降」抬档），除非显式覆盖 */
  const stubProfile = (
    overrides: Partial<PulseAdminMembershipProfileRecord> = {},
  ): void => {
    mutationStateService.loadAdminMemberStateOrThrow.mockResolvedValue({
      profile: {
        currentPlanId: null,
        previousPlanId: null,
        startsAt: new Date('2026-01-01'),
        expiresAt: null,
        totalPoints: 0,
        availablePoints: 0,
        subAccountQuota: 0,
        pulseSubAccountQuota: 0,
        ...overrides,
      } satisfies PulseAdminMembershipProfileRecord,
    });
  };

  beforeEach(() => {
    jest.clearAllMocks();
    stubProfile();
    prismaService.storeMembershipProfile.upsert.mockResolvedValue({ id: 77 });
    mutationStateService.invalidateAdminMemberDerived.mockResolvedValue(
      undefined,
    );
    quotaService.grantByPlan.mockResolvedValue(undefined);
    quotaService.clear.mockResolvedValue(undefined);
    lockedPriceService.upsertDealPrice.mockResolvedValue(undefined);
    prismaService.storeMembershipOrder.create.mockResolvedValue({ id: 900 });
    platformMembershipService.getPlanConfig.mockResolvedValue({
      id: 'yearly',
      name: '年度会员',
      price: 39800,
      originalPrice: 45600,
      durationMonths: 12,
      validDays: 365,
    });
  });

  const run = (dto: Record<string, unknown>) =>
    createService().applyAdminMembershipLevel(user, 18, dto as never);

  /**
   * 与前端弹窗同一口径的到期时间：起算点 + 单期天数 × 期数。
   * 桩里的套餐固定为 365 天/期，多期请求必须自洽，否则会被服务端拒绝。
   */
  const expiryAfterPeriods = (periodCount: number): string =>
    new Date(
      Date.now() + 365 * periodCount * 24 * 60 * 60 * 1000,
    ).toISOString();

  it('年度 × 2：按 300 × 2 = 600 位赠送', async () => {
    await run({
      level: 'annual',
      membershipExpiry: expiryAfterPeriods(2),
      multiplier: 2,
    });

    expect(quotaService.grantByPlan).toHaveBeenCalledWith(
      18,
      'yearly',
      2,
      expect.anything(),
    );
  });

  it('月度 × 3：按 50 × 3 = 150 位赠送', async () => {
    await run({
      level: 'monthly',
      membershipExpiry: expiryAfterPeriods(3),
      multiplier: 3,
    });

    expect(quotaService.grantByPlan).toHaveBeenCalledWith(
      18,
      'monthly',
      3,
      expect.anything(),
    );
  });

  it('季度 × 2：按 100 × 2 = 200 位赠送', async () => {
    await run({
      level: 'quarterly',
      membershipExpiry: expiryAfterPeriods(2),
      multiplier: 2,
    });

    expect(quotaService.grantByPlan).toHaveBeenCalledWith(
      18,
      'quarterly',
      2,
      expect.anything(),
    );
  });

  it('多期时长与期数不符（直调接口刷额度）：拒绝，不发放额度', async () => {
    // 只加 1 天却要 12 期额度——服务端必须复核时长，不能只信调用方
    await expect(
      run({
        level: 'annual',
        membershipExpiry: new Date(Date.now() + 86400000).toISOString(),
        multiplier: 12,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(quotaService.grantByPlan).not.toHaveBeenCalled();
    expect(prismaService.storeMembershipProfile.upsert).not.toHaveBeenCalled();
  });

  it('未传期数：按 1 期赠送', async () => {
    await run({
      level: 'annual',
      membershipExpiry: '2027-12-31T00:00:00.000Z',
    });

    expect(quotaService.grantByPlan).toHaveBeenCalledWith(
      18,
      'yearly',
      1,
      expect.anything(),
    );
  });

  it('非法期数（0 / 小数 / 超上限）：回落 1 期，不会放大赠送', async () => {
    await run({
      level: 'annual',
      membershipExpiry: '2027-12-31T00:00:00.000Z',
      multiplier: 0,
    });
    expect(quotaService.grantByPlan).toHaveBeenCalledWith(
      18,
      'yearly',
      1,
      expect.anything(),
    );

    await run({
      level: 'annual',
      membershipExpiry: '2027-12-31T00:00:00.000Z',
      multiplier: 13,
    });
    expect(quotaService.grantByPlan).toHaveBeenCalledWith(
      18,
      'yearly',
      1,
      expect.anything(),
    );
  });

  it('永久会员没有「期」的概念：即便传了期数也按 1 期赠送', async () => {
    await run({
      level: 'lifetime',
      membershipExpiry: '2099-12-31T00:00:00.000Z',
      multiplier: 6,
    });

    expect(quotaService.grantByPlan).toHaveBeenCalledWith(
      18,
      'lifetime',
      1,
      expect.anything(),
    );
  });

  it('被「只升不降」抬回原档：仍按所选档位赠送（永久会员选月度 = 50 位而非 300）', async () => {
    stubProfile({
      currentPlanId: 'lifetime',
      expiresAt: new Date(Date.now() + 100 * 24 * 60 * 60 * 1000),
    });

    await run({
      level: 'monthly',
      membershipExpiry: '2027-03-31T00:00:00.000Z',
    });

    expect(quotaService.grantByPlan).toHaveBeenCalledWith(
      18,
      'monthly',
      1,
      expect.anything(),
    );
  });

  it('降级为免费：额度清零，不走赠送', async () => {
    await run({ level: 'free', confirmDowngradeToFree: true });

    expect(quotaService.clear).toHaveBeenCalledWith(
      18,
      '设置为免费会员，新用户额度清零',
      expect.anything(),
    );
    expect(quotaService.grantByPlan).not.toHaveBeenCalled();
  });
});
