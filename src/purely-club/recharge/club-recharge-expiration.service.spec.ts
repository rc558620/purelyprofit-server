import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { AlertService } from '../../shared/alert/alert.service';
import { ClubWechatTransactionService } from '../payments/club-wechat-transaction.service';
import { ClubRechargeExpirationService } from './club-recharge-expiration.service';
import { ClubRechargeWechatVerifyService } from './club-recharge-wechat-verify.service';

describe('ClubRechargeExpirationService', () => {
  const prismaService = {
    clubRechargeOrder: {
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
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
  const transactionService = { closeOrder: jest.fn() };
  const verifyService = { verifyAndSettle: jest.fn() };

  let service: ClubRechargeExpirationService;

  beforeEach(() => {
    jest.clearAllMocks();
    redisClient.set.mockResolvedValue('OK');
    prismaService.clubRechargeOrder.findMany.mockResolvedValue([
      { orderNo: 'RC202606101231000001A2B', storeId: 11 },
    ]);
    prismaService.clubRechargeOrder.updateMany.mockResolvedValue({ count: 1 });
    transactionService.closeOrder.mockResolvedValue('closed');

    service = new ClubRechargeExpirationService(
      prismaService as unknown as PrismaService,
      redisService as unknown as RedisService,
      alertService as unknown as AlertService,
      transactionService as unknown as ClubWechatTransactionService,
      verifyService as unknown as ClubRechargeWechatVerifyService,
    );
  });

  it('微信侧关单成功后本地翻转为 expired', async () => {
    await service.expireDueOrders();

    expect(transactionService.closeOrder).toHaveBeenCalledWith({
      storeId: 11,
      orderNo: 'RC202606101231000001A2B',
    });
    expect(prismaService.clubRechargeOrder.updateMany).toHaveBeenCalledWith({
      where: { orderNo: 'RC202606101231000001A2B', status: 'pending' },
      data: { status: 'expired' },
    });
  });

  // E2：微信侧已支付时绝不能关本地单，否则用户付了钱却没有订单可落账
  it('关单时发现微信侧已支付，则不关本地单并转主动核对', async () => {
    transactionService.closeOrder.mockResolvedValue('paid');

    await service.expireDueOrders();

    expect(verifyService.verifyAndSettle).toHaveBeenCalledWith({
      orderNo: 'RC202606101231000001A2B',
      force: true,
    });
    expect(prismaService.clubRechargeOrder.updateMany).not.toHaveBeenCalled();
  });

  // E3：关单结果未知时保持 pending 等下轮重试，禁止直接标 expired
  it('关单失败时保持 pending 并告警', async () => {
    transactionService.closeOrder.mockRejectedValue(new Error('网络异常'));

    await service.expireDueOrders();

    expect(prismaService.clubRechargeOrder.updateMany).not.toHaveBeenCalled();
    expect(alertService.send).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'error' }),
    );
  });

  it('批量关单时按有限并发调用微信，不再逐笔串行', async () => {
    prismaService.clubRechargeOrder.findMany.mockResolvedValue(
      Array.from({ length: 5 }, (_, index) => ({
        orderNo: `RC-BATCH-${index}`,
        storeId: 11,
      })),
    );
    let inFlight = 0;
    let peak = 0;
    transactionService.closeOrder.mockImplementation(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => {
        setTimeout(resolve, 5);
      });
      inFlight -= 1;
      return 'closed';
    });

    await service.expireDueOrders();

    expect(transactionService.closeOrder).toHaveBeenCalledTimes(5);
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(5);
  });

  it('未抢到分布式锁时本轮不处理任何订单', async () => {
    redisClient.set.mockResolvedValue(null);

    await service.expireDueOrders();

    expect(prismaService.clubRechargeOrder.findMany).not.toHaveBeenCalled();
    expect(transactionService.closeOrder).not.toHaveBeenCalled();
  });
});
