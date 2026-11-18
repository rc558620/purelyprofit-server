// 自动打印服务端去重：键为「门店 + 订单 + 目标」，Redis 故障时宁可重复打印也不漏打
import { RedisService } from '../../../redis/redis.service';
import { ScanOrderingPrintDedupeService } from './scan-ordering-print-dedupe.service';

describe('ScanOrderingPrintDedupeService', () => {
  const redisService = { setIfAbsent: jest.fn() };
  let service: ScanOrderingPrintDedupeService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ScanOrderingPrintDedupeService(
      redisService as unknown as RedisService,
    );
  });

  it('首次下发抢占成功', async () => {
    redisService.setIfAbsent.mockResolvedValue(true);

    await expect(
      service.tryAcquireAutoDispatch({
        storeId: 11,
        orderId: 66,
        target: 'kitchen',
      }),
    ).resolves.toBe(true);
    expect(redisService.setIfAbsent).toHaveBeenCalledWith(
      'scan-ordering:print-dedupe:11:66:kitchen',
      expect.any(String),
      7 * 24 * 60 * 60,
    );
  });

  it('同一门店/订单/目标已被占用时返回 false（其他终端已下发）', async () => {
    redisService.setIfAbsent.mockResolvedValue(false);

    await expect(
      service.tryAcquireAutoDispatch({
        storeId: 11,
        orderId: 66,
        target: 'cashier',
      }),
    ).resolves.toBe(false);
  });

  it('Redis 故障时放行（宁可重复打印也不能漏打）', async () => {
    redisService.setIfAbsent.mockRejectedValue(new Error('redis down'));

    await expect(
      service.tryAcquireAutoDispatch({
        storeId: 11,
        orderId: 66,
        target: 'kitchen',
      }),
    ).resolves.toBe(true);
  });
});
