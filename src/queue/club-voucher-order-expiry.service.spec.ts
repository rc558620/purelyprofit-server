import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { ClubVoucherOrderExpiryService } from './club-voucher-order-expiry.service';

describe('ClubVoucherOrderExpiryService', () => {
  let service: ClubVoucherOrderExpiryService;

  const prismaService = {
    clubVoucherOrder: {
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClubVoucherOrderExpiryService,
        { provide: PrismaService, useValue: prismaService },
      ],
    }).compile();

    service = module.get<ClubVoucherOrderExpiryService>(
      ClubVoucherOrderExpiryService,
    );
  });

  it('无待翻转订单时直接返回 0，不发起 UPDATE', async () => {
    prismaService.clubVoucherOrder.findMany.mockResolvedValue([]);

    await expect(service.expireOverdueOrders()).resolves.toBe(0);
    expect(prismaService.clubVoucherOrder.updateMany).not.toHaveBeenCalled();
  });

  it('按「pending 且已过期」条件批量翻转，并以影响行数计数', async () => {
    prismaService.clubVoucherOrder.findMany.mockResolvedValue([
      { id: 1 },
      { id: 2 },
    ]);
    prismaService.clubVoucherOrder.updateMany.mockResolvedValue({ count: 2 });

    await expect(service.expireOverdueOrders()).resolves.toBe(2);

    const findManyArg =
      prismaService.clubVoucherOrder.findMany.mock.calls[0][0];
    expect(findManyArg.where).toEqual({
      status: 'pending',
      expiresAt: { lt: expect.any(Date) as Date },
    });
    expect(findManyArg.orderBy).toEqual({ id: 'asc' });

    const updateArg =
      prismaService.clubVoucherOrder.updateMany.mock.calls[0][0];
    expect(updateArg.data).toEqual({ status: 'expired' });
    // 前置状态 + 有效期条件：被并发实例抢先翻转的行不会被重复计数
    expect(updateArg.where).toMatchObject({
      id: { in: [1, 2] },
      status: 'pending',
      expiresAt: { lt: expect.any(Date) as Date },
    });
  });

  it('并发下受影响行数为 0 时如实返回 0（不虚报翻转数量）', async () => {
    prismaService.clubVoucherOrder.findMany.mockResolvedValue([{ id: 1 }]);
    prismaService.clubVoucherOrder.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.expireOverdueOrders()).resolves.toBe(0);
  });

  it('满是整批时继续翻下一批，空批即停', async () => {
    const fullBatch = Array.from({ length: 500 }, (_item, index) => ({
      id: index + 1,
    }));
    prismaService.clubVoucherOrder.findMany
      .mockResolvedValueOnce(fullBatch)
      .mockResolvedValueOnce([]);
    prismaService.clubVoucherOrder.updateMany.mockResolvedValue({ count: 500 });

    await expect(service.expireOverdueOrders()).resolves.toBe(500);
    expect(prismaService.clubVoucherOrder.findMany).toHaveBeenCalledTimes(2);
  });

  it('异常数据（每批都被抢占）时按最大批次数收敛，不无限循环', async () => {
    const fullBatch = Array.from({ length: 500 }, (_item, index) => ({
      id: index + 1,
    }));
    prismaService.clubVoucherOrder.findMany.mockResolvedValue(fullBatch);
    prismaService.clubVoucherOrder.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.expireOverdueOrders()).resolves.toBe(0);
    expect(prismaService.clubVoucherOrder.findMany).toHaveBeenCalledTimes(20);
  });
});
