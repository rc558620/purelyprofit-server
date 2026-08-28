import { Test, TestingModule } from '@nestjs/testing';
import { ScanOrderingPickupNumberService } from './scan-ordering-pickup-number.service';

/**
 * 上海业务日边界：
 * - 2026-08-05T15:59:59.999Z = 上海 2026-08-05 23:59:59.999
 * - 2026-08-05T16:00:00.000Z = 上海 2026-08-06 00:00:00
 */
const BEFORE_MIDNIGHT_MS = new Date('2026-08-05T15:59:59.999Z').getTime();
const AT_MIDNIGHT_MS = new Date('2026-08-05T16:00:00.000Z').getTime();

describe('ScanOrderingPickupNumberService', () => {
  let service: ScanOrderingPickupNumberService;

  const tx = {
    scanOrders: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    scanOrderingPickupSequence: {
      upsert: jest.fn(),
    },
    $queryRaw: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [ScanOrderingPickupNumberService],
    }).compile();

    service = module.get<ScanOrderingPickupNumberService>(
      ScanOrderingPickupNumberService,
    );
  });

  describe('getShanghaiBusinessDate 上海业务日', () => {
    it('23:59:59.999 属于当天业务日', () => {
      const { businessDate, nextDayStartMs } =
        service.getShanghaiBusinessDate(BEFORE_MIDNIGHT_MS);
      expect(businessDate.toISOString().slice(0, 10)).toBe('2026-08-05');
      expect(nextDayStartMs).toBe(AT_MIDNIGHT_MS);
    });

    it('00:00:00 进入新业务日（跨日重置取餐号）', () => {
      const { businessDate } = service.getShanghaiBusinessDate(AT_MIDNIGHT_MS);
      expect(businessDate.toISOString().slice(0, 10)).toBe('2026-08-06');
    });
  });

  describe('formatPickupNumber 取餐号格式化', () => {
    it('1-999 补零三位显示', () => {
      expect(service.formatPickupNumber(1)).toBe('001');
      expect(service.formatPickupNumber(42)).toBe('042');
      expect(service.formatPickupNumber(999)).toBe('999');
    });

    it('1000 及以上直接显示', () => {
      expect(service.formatPickupNumber(1000)).toBe('1000');
      expect(service.formatPickupNumber(1001)).toBe('1001');
    });

    it('空值返回 null', () => {
      expect(service.formatPickupNumber(null)).toBeNull();
      expect(service.formatPickupNumber(undefined)).toBeNull();
      expect(service.formatPickupNumber(0)).toBeNull();
    });
  });

  describe('assignForPaidOrder 分配取餐号', () => {
    const orderId = 1001;
    const storeId = 11;

    beforeEach(() => {
      tx.scanOrders.findUnique.mockResolvedValue({
        storeId,
        pickupNumber: null,
      });
      tx.scanOrderingPickupSequence.upsert.mockResolvedValue({ id: 1 });
      tx.$queryRaw.mockResolvedValue([{ id: 1, next_number: 1 }]);
      tx.scanOrders.update.mockResolvedValue({
        id: orderId,
        pickupNumber: 1,
      });
    });

    it('分配 001 并写入订单', async () => {
      const result = await service.assignForPaidOrder(
        tx as never,
        orderId,
        storeId,
        AT_MIDNIGHT_MS,
      );

      expect(result).toEqual({
        pickupNumber: 1,
        pickupNumberLabel: '001',
        pickupBusinessDate: new Date('2026-08-06T00:00:00.000Z'),
      });
      expect(tx.scanOrderingPickupSequence.upsert).toHaveBeenCalledWith({
        where: {
          storeId_businessDate: {
            storeId,
            businessDate: new Date('2026-08-06T00:00:00.000Z'),
          },
        },
        update: {},
        create: expect.objectContaining({
          storeId,
          nextNumber: 1,
        }),
      });
      expect(tx.scanOrders.update).toHaveBeenCalledWith({
        where: { id: orderId },
        data: expect.objectContaining({
          pickupNumber: 1,
          pickupNumberStatus: 'assigned',
        }),
      });
    });

    it('同一订单重复分配返回 null（重复支付回调不重复占号）', async () => {
      tx.scanOrders.findUnique.mockResolvedValue({
        storeId,
        pickupNumber: 7,
      });

      const result = await service.assignForPaidOrder(
        tx as never,
        orderId,
        storeId,
      );

      expect(result).toBeNull();
      expect(tx.scanOrderingPickupSequence.upsert).not.toHaveBeenCalled();
      expect(tx.scanOrders.update).not.toHaveBeenCalled();
    });

    it('订单不存在返回 null', async () => {
      tx.scanOrders.findUnique.mockResolvedValue(null);

      const result = await service.assignForPaidOrder(
        tx as never,
        orderId,
        storeId,
      );

      expect(result).toBeNull();
    });

    it('门店不匹配返回 null', async () => {
      tx.scanOrders.findUnique.mockResolvedValue({
        storeId: 999,
        pickupNumber: null,
      });

      const result = await service.assignForPaidOrder(
        tx as never,
        orderId,
        storeId,
      );

      expect(result).toBeNull();
    });

    it('门店 A/B 各自独立计数（互不干扰）', async () => {
      // 门店 A 已到 002，下一号为 003
      tx.$queryRaw.mockResolvedValue([{ id: 1, next_number: 3 }]);
      const resultA = await service.assignForPaidOrder(
        tx as never,
        1001,
        11,
        AT_MIDNIGHT_MS,
      );

      // 门店 B 从 001 重新开始
      tx.scanOrders.findUnique.mockResolvedValue({
        storeId: 22,
        pickupNumber: null,
      });
      tx.$queryRaw.mockResolvedValue([{ id: 2, next_number: 1 }]);
      const resultB = await service.assignForPaidOrder(
        tx as never,
        1002,
        22,
        AT_MIDNIGHT_MS,
      );

      expect(resultA?.pickupNumber).toBe(3);
      expect(resultA?.pickupNumberLabel).toBe('003');
      expect(resultB?.pickupNumber).toBe(1);
      expect(resultB?.pickupNumberLabel).toBe('001');
    });

    it('使用原子递增 SQL 分配连续且不重复的取餐号', async () => {
      tx.$queryRaw
        .mockResolvedValueOnce([{ next_number: 5 }])
        .mockResolvedValueOnce([{ next_number: 6 }]);
      tx.scanOrders.findUnique.mockResolvedValue({
        storeId,
        pickupNumber: null,
      });

      const first = await service.assignForPaidOrder(
        tx as never,
        2001,
        storeId,
        AT_MIDNIGHT_MS,
      );
      const second = await service.assignForPaidOrder(
        tx as never,
        2002,
        storeId,
        AT_MIDNIGHT_MS,
      );

      expect(first?.pickupNumber).toBe(5);
      expect(second?.pickupNumber).toBe(6);
      expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
      const rawArg = tx.$queryRaw.mock.calls[0][0] as {
        strings: string[];
      };
      const sql = rawArg.strings.join('');
      expect(sql).toContain('UPDATE "scan_ordering_pickup_sequences"');
      expect(sql).toContain('RETURNING "next_number" - 1');
      expect(sql).not.toContain('FOR UPDATE');
    });
  });
});
