import type { CacheInvalidatorService } from '../../redis/cache-invalidator.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { ScanOrderingRealtimeService } from '../scan-ordering/scan-ordering-realtime.service';
import type { ClubPaymentModeService } from '../payments/club-payment-mode.service';
import {
  isVoucherCodeUniqueViolation,
  pickUniqueVoucherCode,
} from './club-voucher-order-payment.helper';
import { ClubVoucherOrderSettlementService } from './club-voucher-order-settlement.service';
import { VOUCHER_CODE_RETRY_TIMES } from './club-voucher-order-payment.types';

/** 唯一约束冲突（P2002）：并发抢占同一枚候选券码 */
const uniqueViolation = (): Error =>
  Object.assign(new Error('Unique constraint failed on voucher_code'), {
    code: 'P2002',
  });

const order = {
  id: 501,
  storeId: 11,
  orderNo: 'VC20261116000001',
  orderNoSnapshot: 'VC20261116000001',
  productId: 21,
  quantity: 1,
  paidAmountFen: 9900,
  paymentChannel: 'wechat',
  pointsUsed: 0,
  customerId: 7,
  guestName: '张三',
  guestPhone: '13800000000',
  productName: '双人套餐',
  categoryName: '餐饮',
  remark: null,
  createdAt: new Date('2026-11-16T00:00:00.000Z'),
};

describe('pickUniqueVoucherCode（事务外批量查重）', () => {
  it('一次 IN 查询挑出未被占用的候选码', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const code = await pickUniqueVoucherCode({
      clubVoucherOrder: { findMany },
    } as never);

    expect(code).toMatch(/^[A-Z0-9]+$/);
    expect(findMany).toHaveBeenCalledTimes(1);
    const where = findMany.mock.calls[0]![0].where as {
      voucherCode: { in: string[] };
    };
    expect(where.voucherCode.in).toHaveLength(VOUCHER_CODE_RETRY_TIMES);
    expect(where.voucherCode.in).toContain(code);
  });

  it('候选码全被占用时抛「券码生成失败」（不再逐条重试查询）', async () => {
    const findMany = jest.fn().mockImplementation((args: unknown) => {
      const where = (args as { where: { voucherCode: { in: string[] } } })
        .where;
      return Promise.resolve(
        where.voucherCode.in.map((voucherCode) => ({ voucherCode })),
      );
    });

    await expect(
      pickUniqueVoucherCode({ clubVoucherOrder: { findMany } } as never),
    ).rejects.toThrow('券码生成失败，请重试');
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it('只认 P2002，其它错误不得触发换码重试', () => {
    expect(isVoucherCodeUniqueViolation(uniqueViolation())).toBe(true);
    expect(isVoucherCodeUniqueViolation(new Error('db down'))).toBe(false);
    expect(isVoucherCodeUniqueViolation(null)).toBe(false);
  });
});

describe('ClubVoucherOrderSettlementService 落账券码', () => {
  const buildTx = () => ({
    clubVoucherOrder: {
      findUnique: jest.fn().mockResolvedValue(order),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn().mockImplementation((args: { data: unknown }) => ({
        ...order,
        status: 'pending',
        voucherCode: (args.data as { voucherCode: string }).voucherCode,
      })),
    },
    marketingProduct: {
      findUnique: jest.fn().mockResolvedValue({ stock: 10, validDays: 30 }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    marketingCustomer: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn().mockResolvedValue({}),
    },
    marketingPointsRecord: { create: jest.fn() },
    marketingConsumption: { create: jest.fn() },
    $queryRaw: jest.fn(),
  });

  const buildService = (prisma: Record<string, unknown>) =>
    new ClubVoucherOrderSettlementService(
      prisma as unknown as PrismaService,
      {} as ClubPaymentModeService,
      {
        invalidateMarketingCustomerDerived: jest.fn(),
        invalidateMembersDerived: jest.fn(),
      } as unknown as CacheInvalidatorService,
      {
        publishVoucherOrderCreated: jest.fn(),
      } as unknown as ScanOrderingRealtimeService,
    );

  it('券码在事务外查重，事务内不再按券码回查', async () => {
    const tx = buildTx();
    const prisma = {
      clubVoucherOrder: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn((fn: (client: unknown) => unknown) => fn(tx)),
    };

    const view = await buildService(prisma).completePayment(order.id, 9900);

    expect(prisma.clubVoucherOrder.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    // 事务内只允许按 id 定位订单，不得再出现 voucherCode 条件
    for (const call of tx.clubVoucherOrder.findUnique.mock.calls) {
      expect(
        (call[0] as { where: Record<string, unknown> }).where,
      ).not.toHaveProperty('voucherCode');
    }
    expect(view.voucherCode).toMatch(/^[A-Z0-9]+$/);
  });

  it('并发抢码（P2002）时换码重跑落账，行为与改造前一致', async () => {
    const tx = buildTx();
    const prisma = {
      clubVoucherOrder: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest
        .fn()
        .mockRejectedValueOnce(uniqueViolation())
        .mockImplementationOnce((fn: (client: unknown) => unknown) => fn(tx)),
    };

    const view = await buildService(prisma).completePayment(order.id, 9900);

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    // 每次重试都重新取一枚候选码（仍是一条批量查询）
    expect(prisma.clubVoucherOrder.findMany).toHaveBeenCalledTimes(2);
    expect(view.status).toBe('pending');
  });

  it('非 P2002 错误不重试，直接冒泡（避免无意义地重复扣库存）', async () => {
    const prisma = {
      clubVoucherOrder: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn().mockRejectedValue(new Error('db down')),
    };

    await expect(
      buildService(prisma).completePayment(order.id, 9900),
    ).rejects.toThrow('db down');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});
