import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';
import type { PrismaExecutor } from '../platform-membership/platform-membership.types';
import {
  NEW_CUSTOMER_QUOTA_EXHAUSTED_CODE,
  NEW_CUSTOMER_QUOTA_EXHAUSTED_MESSAGE,
  NEW_CUSTOMER_QUOTA_WARNING_THRESHOLD,
} from './new-customer-quota.constants';
import { NewCustomerQuotaService } from './new-customer-quota.service';

describe('NewCustomerQuotaService', () => {
  let service: NewCustomerQuotaService;

  /** 扣减前按 clubUserId 加事务级顾问锁（跨店并发首单串行化） */
  const executeRaw = jest.fn();

  /** 事务内外共用同一批 delegate：事务内传入的就是这份 mock */
  const delegates = {
    storeMembershipProfile: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    storeNewCustomerQuotaLog: {
      create: jest.fn(),
      findMany: jest.fn(),
      aggregate: jest.fn(),
    },
    storeNewCustomerQuotaConsume: {
      create: jest.fn(),
      findUnique: jest.fn(),
    },
    $executeRaw: executeRaw,
  };

  /** adjustQuota 用 $queryRaw 下发带 FOR UPDATE 的加锁查询，事务内外同样复用 */
  const queryRaw = jest.fn();

  const prismaService = {
    ...delegates,
    $queryRaw: queryRaw,
    $transaction: jest.fn((fn: (tx: unknown) => Promise<unknown>) =>
      fn({ ...delegates, $queryRaw: queryRaw }),
    ),
  };

  /** 让 getOverview 返回指定余额：findUnique + 两条 aggregate */
  const mockOverviewRead = (remaining: number, consumed: number): void => {
    delegates.storeMembershipProfile.findUnique.mockResolvedValue({
      newCustomerQuota: remaining,
      newCustomerQuotaConsumed: consumed,
    });
    delegates.storeNewCustomerQuotaLog.aggregate.mockResolvedValue({
      _sum: { changeAmount: 0 },
    });
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NewCustomerQuotaService,
        { provide: PrismaService, useValue: prismaService },
      ],
    }).compile();

    service = module.get<NewCustomerQuotaService>(NewCustomerQuotaService);
  });

  it('门店无会员档案时概览全部归零，预警阈值取默认 100', async () => {
    delegates.storeMembershipProfile.findUnique.mockResolvedValue(null);
    delegates.storeNewCustomerQuotaLog.aggregate.mockResolvedValue({
      _sum: { changeAmount: null },
    });

    await expect(service.getOverview(42)).resolves.toEqual({
      storeId: 42,
      remaining: 0,
      warningThreshold: NEW_CUSTOMER_QUOTA_WARNING_THRESHOLD,
      totalRecharged: 0,
      totalGranted: 0,
      totalConsumed: 0,
    });
  });

  it('有余额时汇总充值/赠送/已服务新客', async () => {
    delegates.storeMembershipProfile.findUnique.mockResolvedValue({
      newCustomerQuota: 86,
      newCustomerQuotaConsumed: 547,
    });
    delegates.storeNewCustomerQuotaLog.aggregate
      .mockResolvedValueOnce({ _sum: { changeAmount: 333 } })
      .mockResolvedValueOnce({ _sum: { changeAmount: 300 } });

    await expect(service.getOverview(42)).resolves.toEqual({
      storeId: 42,
      remaining: 86,
      warningThreshold: NEW_CUSTOMER_QUOTA_WARNING_THRESHOLD,
      totalRecharged: 333,
      totalGranted: 300,
      totalConsumed: 547,
    });
  });

  it('充值档位：金额与新客数都由后端计算（0.03 元/位新客）', () => {
    expect(service.getTiers()).toEqual([
      { amountFen: 1000, amountDisplay: '¥10', quotaCount: 333 },
      { amountFen: 5000, amountDisplay: '¥50', quotaCount: 1666 },
      { amountFen: 10000, amountDisplay: '¥100', quotaCount: 3333 },
    ]);
  });

  it('非法充值档位直接拒绝，不写库', async () => {
    await expect(service.recharge(42, 9999)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(delegates.storeMembershipProfile.upsert).not.toHaveBeenCalled();
    expect(delegates.storeNewCustomerQuotaLog.create).not.toHaveBeenCalled();
  });

  it('充值到账：余额叠加并写充值流水', async () => {
    delegates.storeMembershipProfile.upsert.mockResolvedValue({ storeId: 42 });
    delegates.storeMembershipProfile.update.mockResolvedValue({
      newCustomerQuota: 333,
    });
    mockOverviewRead(333, 0);

    await expect(service.recharge(42, 1000)).resolves.toMatchObject({
      remaining: 333,
    });

    expect(delegates.storeMembershipProfile.update).toHaveBeenCalledWith({
      where: { storeId: 42 },
      data: { newCustomerQuota: { increment: 333 } },
      select: { newCustomerQuota: true },
    });
    expect(delegates.storeNewCustomerQuotaLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          storeId: 42,
          type: 'recharge',
          changeAmount: 333,
          balanceAfter: 333,
          amountFen: 1000,
        }),
      }),
    );
  });

  it('会员赠送：月度 +50，永久同年度 +300', async () => {
    delegates.storeMembershipProfile.upsert.mockResolvedValue({ storeId: 42 });
    delegates.storeMembershipProfile.update.mockResolvedValue({
      newCustomerQuota: 50,
    });

    await expect(service.grantByPlan(42, 'monthly')).resolves.toBe(50);
    await expect(service.grantByPlan(42, 'lifetime')).resolves.toBe(300);
    expect(delegates.storeNewCustomerQuotaLog.create).toHaveBeenCalledTimes(2);
  });

  it('会员赠送按期数叠加：年度 × 2 = 600，且流水标注期数', async () => {
    delegates.storeMembershipProfile.upsert.mockResolvedValue({ storeId: 42 });
    delegates.storeMembershipProfile.update.mockResolvedValue({
      newCustomerQuota: 600,
    });

    await expect(service.grantByPlan(42, 'yearly', 2)).resolves.toBe(600);
    expect(delegates.storeMembershipProfile.update).toHaveBeenCalledWith({
      where: { storeId: 42 },
      data: { newCustomerQuota: { increment: 600 } },
      select: { newCustomerQuota: true },
    });
    expect(delegates.storeNewCustomerQuotaLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'grant',
          changeAmount: 600,
          description: '年度会员赠送 ×2',
        }),
      }),
    );
  });

  it('会员赠送：非法期数（0 / 小数）按 1 期处理', async () => {
    delegates.storeMembershipProfile.upsert.mockResolvedValue({ storeId: 42 });
    delegates.storeMembershipProfile.update.mockResolvedValue({
      newCustomerQuota: 300,
    });

    await expect(service.grantByPlan(42, 'yearly', 0)).resolves.toBe(300);
    await expect(service.grantByPlan(42, 'yearly', 1.5)).resolves.toBe(300);
  });

  it('免费会员不赠送额度，也不写流水', async () => {
    await expect(service.grantByPlan(42, 'free')).resolves.toBe(0);
    expect(delegates.storeNewCustomerQuotaLog.create).not.toHaveBeenCalled();
    await expect(service.grantByPlan(42, undefined)).resolves.toBe(0);
  });

  it('清零：有余额时写清零流水，余额为 0 时不写', async () => {
    delegates.storeMembershipProfile.findUnique.mockResolvedValue({
      newCustomerQuota: 50,
    });
    await service.clear(42, '设置为免费会员，新用户额度清零');
    expect(delegates.storeMembershipProfile.update).toHaveBeenCalledWith({
      where: { storeId: 42 },
      data: { newCustomerQuota: 0 },
    });
    expect(delegates.storeNewCustomerQuotaLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'clear',
          changeAmount: -50,
          balanceAfter: 0,
        }),
      }),
    );

    delegates.storeNewCustomerQuotaLog.create.mockClear();
    delegates.storeMembershipProfile.findUnique.mockResolvedValue({
      newCustomerQuota: 0,
    });
    await service.clear(42, '注销账号，新用户额度清零');
    expect(delegates.storeNewCustomerQuotaLog.create).not.toHaveBeenCalled();
  });

  // ─── 运营调额（adjustQuota） ────────────────────────────────────────

  it('运营发放额度：记 admin_adjust 流水，不污染「会员赠送」统计', async () => {
    queryRaw.mockResolvedValue([{ remaining: 100 }]);
    delegates.storeMembershipProfile.update.mockResolvedValue({
      newCustomerQuota: 150,
    });

    await expect(service.adjustQuota(42, 50, '平台运营调整新客额度')).resolves.toBe(
      150,
    );

    expect(delegates.storeMembershipProfile.update).toHaveBeenCalledWith({
      where: { storeId: 42 },
      data: { newCustomerQuota: 150 },
    });
    expect(delegates.storeNewCustomerQuotaLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          storeId: 42,
          type: 'admin_adjust',
          changeAmount: 50,
          balanceAfter: 150,
        }),
      }),
    );
  });

  it('运营回收额度超过余额时只扣到 0，流水按实际变动量记', async () => {
    queryRaw.mockResolvedValue([{ remaining: 30 }]);

    await expect(service.adjustQuota(42, -80, '平台运营调整新客额度')).resolves.toBe(
      0,
    );

    expect(delegates.storeNewCustomerQuotaLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'admin_adjust',
          changeAmount: -30,
          balanceAfter: 0,
        }),
      }),
    );
  });

  it('余额已是 0 仍继续回收时不写流水（避免 0 变动噪音记录）', async () => {
    queryRaw.mockResolvedValue([{ remaining: 0 }]);

    await expect(service.adjustQuota(42, -10, '平台运营调整新客额度')).resolves.toBe(
      0,
    );

    expect(delegates.storeMembershipProfile.update).not.toHaveBeenCalled();
    expect(delegates.storeNewCustomerQuotaLog.create).not.toHaveBeenCalled();
  });

  it('读余额必须先加锁：并发调额不能基于同一个旧余额各自写回', async () => {
    queryRaw.mockResolvedValue([{ remaining: 100 }]);

    await service.adjustQuota(42, 50, '平台运营调整新客额度');

    const sql = String(queryRaw.mock.calls[0]?.[0] ?? '');
    // FOR UPDATE 是关键：没有它，两次并发调额会互相覆盖（丢失更新）
    expect(sql.replace(/\s+/g, ' ').toUpperCase()).toContain('FOR UPDATE');
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it('档案不存在时加锁查询回空，按余额 0 处理', async () => {
    queryRaw.mockResolvedValue([]);

    await expect(service.adjustQuota(42, 20, '平台运营调整新客额度')).resolves.toBe(
      20,
    );
  });

  it('新客扣减：余额充足时扣 1 并写消耗流水', async () => {
    delegates.storeNewCustomerQuotaConsume.create.mockResolvedValue({ id: 1 });
    delegates.storeMembershipProfile.updateMany.mockResolvedValue({ count: 1 });
    delegates.storeMembershipProfile.findUnique.mockResolvedValue({
      newCustomerQuota: 85,
    });

    await expect(
      service.consumeForNewCustomer(42, 1001, '13800000000'),
    ).resolves.toEqual({
      consumed: true,
      remaining: 85,
    });
    // 幂等键必须是账号，手机号仅作快照
    expect(delegates.storeNewCustomerQuotaConsume.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          storeId: 42,
          clubUserId: 1001,
          phone: '13800000000',
        }),
      }),
    );
    expect(delegates.storeNewCustomerQuotaLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'consume',
          changeAmount: -1,
          balanceAfter: 85,
        }),
      }),
    );
  });

  it('同一顾客重复下单不重复扣减（幂等）', async () => {
    // 老客必须在写入前被识别出来：不能靠 insert 撞唯一约束再兜——
    // PostgreSQL 下事务内一旦触发 P2002，整个事务进入 aborted，会把建单一起拖垮
    delegates.storeNewCustomerQuotaConsume.findUnique.mockResolvedValueOnce({
      id: 9,
    });
    delegates.storeMembershipProfile.findUnique.mockResolvedValue({
      newCustomerQuota: 85,
    });

    await expect(
      service.consumeForNewCustomer(42, 1001, '13800000000'),
    ).resolves.toEqual({
      consumed: false,
      remaining: 85,
    });
    expect(
      delegates.storeNewCustomerQuotaConsume.create,
    ).not.toHaveBeenCalled();
    expect(delegates.storeMembershipProfile.updateMany).not.toHaveBeenCalled();
    expect(delegates.storeNewCustomerQuotaLog.create).not.toHaveBeenCalled();
  });

  it('换店不二次计费：已在别家店消耗过的顾客，本店下单不扣额度', async () => {
    // 手机号认证一位顾客只需一次：A 店认证过之后换到 B 店不再验证、不再扣额度。
    // 判定必须是全局的（只按 clubUserId），否则每换一家店就多扣一个额度。
    delegates.storeNewCustomerQuotaConsume.findUnique.mockResolvedValue({
      id: 9,
    });
    delegates.storeMembershipProfile.findUnique.mockResolvedValue({
      newCustomerQuota: 30,
    });

    await expect(
      service.consumeForNewCustomer(99, 1001, '13800000000'),
    ).resolves.toEqual({
      consumed: false,
      remaining: 30,
    });

    expect(
      delegates.storeNewCustomerQuotaConsume.findUnique,
    ).toHaveBeenCalledWith(
      expect.objectContaining({ where: { clubUserId: 1001 } }),
    );
    expect(delegates.storeMembershipProfile.updateMany).not.toHaveBeenCalled();
    expect(
      delegates.storeNewCustomerQuotaConsume.create,
    ).not.toHaveBeenCalled();
  });

  it('传入事务客户端时复用连接，不再嵌套开事务', async () => {
    delegates.storeNewCustomerQuotaConsume.findUnique.mockResolvedValue(null);
    delegates.storeNewCustomerQuotaConsume.create.mockResolvedValue({ id: 1 });
    delegates.storeMembershipProfile.updateMany.mockResolvedValue({ count: 1 });
    delegates.storeMembershipProfile.findUnique.mockResolvedValue({
      newCustomerQuota: 84,
    });

    await expect(
      service.consumeForNewCustomer(
        42,
        1001,
        null,
        delegates as unknown as PrismaExecutor,
      ),
    ).resolves.toEqual({ consumed: true, remaining: 84 });

    // 已在事务里：不能调用 $transaction（Prisma 事务客户端没有该方法）
    expect(prismaService.$transaction).not.toHaveBeenCalled();
    expect(delegates.storeMembershipProfile.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { storeId: 42, newCustomerQuota: { gt: 0 } },
      }),
    );
  });

  it('扣减前按 clubUserId 加事务级顾问锁：跨店并发首单不会撞唯一键', async () => {
    delegates.storeNewCustomerQuotaConsume.findUnique.mockResolvedValue(null);
    delegates.storeNewCustomerQuotaConsume.create.mockResolvedValue({ id: 1 });
    delegates.storeMembershipProfile.updateMany.mockResolvedValue({ count: 1 });
    delegates.storeMembershipProfile.findUnique.mockResolvedValue({
      newCustomerQuota: 7,
    });

    await service.consumeForNewCustomer(42, 1001, null);

    // 唯一键是账号全局唯一：两个门店同时服务同一位新客时，没有这把锁就会
    // 各自扣减、后插入者撞 P2002，进而让整笔建单事务 aborted（抛库错误而非额度文案）
    const sql = String(executeRaw.mock.calls[0]?.[0] ?? '');
    expect(sql.replace(/\s+/g, ' ').toUpperCase()).toContain(
      'PG_ADVISORY_XACT_LOCK',
    );
    // xact 版本随事务提交/回滚自动释放，不需要显式解锁
    expect(executeRaw).toHaveBeenCalledTimes(1);
  });

  it('额度耗尽时抛业务码 NEW_CUSTOMER_QUOTA_EXHAUSTED，且不写消耗流水', async () => {
    delegates.storeNewCustomerQuotaConsume.create.mockResolvedValue({ id: 1 });
    delegates.storeMembershipProfile.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.consumeForNewCustomer(42, 1001, '13800000000'),
    ).rejects.toMatchObject({
      response: {
        message: NEW_CUSTOMER_QUOTA_EXHAUSTED_MESSAGE,
        code: NEW_CUSTOMER_QUOTA_EXHAUSTED_CODE,
      },
    });
    expect(delegates.storeNewCustomerQuotaLog.create).not.toHaveBeenCalled();
  });

  it('并发扣减不会超卖：条件更新命中 0 行即视为额度不足', async () => {
    delegates.storeNewCustomerQuotaConsume.create.mockResolvedValue({ id: 1 });
    delegates.storeMembershipProfile.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.consumeForNewCustomer(42, 1001, '13800000000'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(delegates.storeMembershipProfile.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { storeId: 42, newCustomerQuota: { gt: 0 } },
      }),
    );
  });

  it('新客判定：全局无该顾客的消耗记录即为新客（按账号，不看手机号档案）', async () => {
    delegates.storeNewCustomerQuotaConsume.findUnique.mockResolvedValueOnce(
      null,
    );
    await expect(service.isNewCustomer(1001)).resolves.toBe(true);
    // 唯一键只有账号：换店不再产生第二条消耗记录
    expect(
      delegates.storeNewCustomerQuotaConsume.findUnique,
    ).toHaveBeenCalledWith(
      expect.objectContaining({ where: { clubUserId: 1001 } }),
    );

    delegates.storeNewCustomerQuotaConsume.findUnique.mockResolvedValueOnce({
      id: 9,
    });
    await expect(service.isNewCustomer(1001)).resolves.toBe(false);
  });

  it('下单闸门：老客（已在任意门店消耗过额度）直接放行，不查余额', async () => {
    delegates.storeNewCustomerQuotaConsume.findUnique.mockResolvedValue({
      id: 9,
    });
    delegates.storeMembershipProfile.findUnique.mockResolvedValue({
      newCustomerQuota: 0,
    });

    await expect(service.ensureAvailableForNewCustomer(42, 1001)).resolves.toBe(
      false,
    );
    expect(delegates.storeMembershipProfile.findUnique).not.toHaveBeenCalled();
  });

  it('下单闸门：新客且本店额度已用完 → 抛 NEW_CUSTOMER_QUOTA_EXHAUSTED 阻止建单', async () => {
    delegates.storeNewCustomerQuotaConsume.findUnique.mockResolvedValue(null);
    delegates.storeMembershipProfile.findUnique.mockResolvedValue({
      newCustomerQuota: 0,
    });

    await expect(
      service.ensureAvailableForNewCustomer(42, 1001),
    ).rejects.toMatchObject({
      response: {
        message: NEW_CUSTOMER_QUOTA_EXHAUSTED_MESSAGE,
        code: NEW_CUSTOMER_QUOTA_EXHAUSTED_CODE,
      },
    });
  });

  it('下单闸门：新客且额度充足 → 放行', async () => {
    delegates.storeNewCustomerQuotaConsume.findUnique.mockResolvedValue(null);
    delegates.storeMembershipProfile.findUnique.mockResolvedValue({
      newCustomerQuota: 12,
    });

    await expect(service.ensureAvailableForNewCustomer(42, 1001)).resolves.toBe(
      true,
    );
  });

  it('预检：余额大于 0 才允许', async () => {
    delegates.storeMembershipProfile.findUnique.mockResolvedValueOnce({
      newCustomerQuota: 0,
    });
    await expect(service.hasRemaining(42)).resolves.toBe(false);

    delegates.storeMembershipProfile.findUnique.mockResolvedValueOnce({
      newCustomerQuota: 1,
    });
    await expect(service.hasRemaining(42)).resolves.toBe(true);
  });
});
