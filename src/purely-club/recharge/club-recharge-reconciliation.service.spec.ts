import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { AlertService } from '../../shared/alert/alert.service';
import { ClubRechargeReconciliationService } from './club-recharge-reconciliation.service';
import { ClubRechargeWechatVerifyService } from './club-recharge-wechat-verify.service';

describe('ClubRechargeReconciliationService', () => {
  const prismaService = {
    clubRechargeOrder: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
  const redisClient = {
    set: jest.fn().mockResolvedValue('OK'),
    eval: jest.fn().mockResolvedValue(1),
  };
  const redisService = {
    getClient: jest.fn(() => redisClient),
  };
  const alertService = { send: jest.fn().mockResolvedValue(undefined) };
  const verifyService = { verifyAndSettle: jest.fn() };

  let service: ClubRechargeReconciliationService;

  beforeEach(() => {
    jest.clearAllMocks();
    redisClient.set.mockResolvedValue('OK');
    alertService.send.mockResolvedValue(undefined);
    verifyService.verifyAndSettle.mockResolvedValue({ status: 'pending' });

    service = new ClubRechargeReconciliationService(
      prismaService as unknown as PrismaService,
      redisService as unknown as RedisService,
      alertService as unknown as AlertService,
      verifyService as unknown as ClubRechargeWechatVerifyService,
    );
  });

  it('只扫描跨天仍未决的充值订单', async () => {
    await service.reconcileStaleOrders();

    expect(prismaService.clubRechargeOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'pending',
          createdAt: { lt: expect.any(Date) },
          deletedAt: null,
        }),
      }),
    );
  });

  // G3：对账的价值就是把「已扣款、本地仍 pending」的订单补上，并惊动相关人
  it('对账发现微信侧已支付时补落账并告警', async () => {
    prismaService.clubRechargeOrder.findMany.mockResolvedValue([
      { orderNo: 'RC202606101231000001A2B' },
    ]);
    verifyService.verifyAndSettle.mockResolvedValue({ status: 'paid' });

    await expect(service.reconcileStaleOrders()).resolves.toEqual({
      scanned: 1,
      settled: 1,
      failed: 0,
    });

    expect(verifyService.verifyAndSettle).toHaveBeenCalledWith({
      orderNo: 'RC202606101231000001A2B',
      force: true,
    });
    expect(alertService.send).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'warn' }),
    );
  });

  it('全部订单均未支付时不打扰（不告警）', async () => {
    prismaService.clubRechargeOrder.findMany.mockResolvedValue([
      { orderNo: 'RC202606101231000001A2B' },
    ]);

    await expect(service.reconcileStaleOrders()).resolves.toEqual({
      scanned: 1,
      settled: 0,
      failed: 0,
    });

    expect(alertService.send).not.toHaveBeenCalled();
  });

  it('单笔核对异常不影响其它订单，并计入失败数', async () => {
    prismaService.clubRechargeOrder.findMany.mockResolvedValue([
      { orderNo: 'RC-A' },
      { orderNo: 'RC-B' },
    ]);
    verifyService.verifyAndSettle
      .mockRejectedValueOnce(new Error('微信接口超时'))
      .mockResolvedValueOnce({ status: 'paid' });

    await expect(service.reconcileStaleOrders()).resolves.toEqual({
      scanned: 2,
      settled: 1,
      failed: 1,
    });

    expect(alertService.send).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'error' }),
    );
  });

  it('未抢到分布式锁时本轮不核对任何订单', async () => {
    redisClient.set.mockResolvedValue(null);

    await expect(service.reconcileStaleOrders()).resolves.toEqual({
      scanned: 0,
      settled: 0,
      failed: 0,
    });

    expect(prismaService.clubRechargeOrder.findMany).not.toHaveBeenCalled();
  });
});
