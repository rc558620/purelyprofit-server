// 商家端团购券订单服务回归用例：惰性过期探测/分批、状态索引口径、确认条件更新与幂等。
import { BadRequestException, ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { PrismaService } from '../../../prisma/prisma.service';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { ScanOrderingRealtimeService } from '../../../purely-club/scan-ordering/scan-ordering-realtime.service';
import { ClubVoucherOrderRefundService } from '../../../purely-club/voucher-orders/club-voucher-order-refund.service';
import { VoucherOrdersService } from './voucher-orders.service';
import { VoucherOrderStatusFilter } from './dto/voucher-order-management.dto';
import {
  EXPIRE_SCAN_BATCH_SIZE,
  EXPIRE_SCAN_MAX_BATCHES,
} from './voucher-order-management.helper';

const currentUser = {} as AuthenticatedUser;

const createService = async (): Promise<{
  service: VoucherOrdersService;
  prisma: {
    clubVoucherOrder: {
      updateMany: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      findFirst: jest.Mock;
      update: jest.Mock;
    };
  };
  realtime: { publishVoucherOrderConfirmed: jest.Mock };
}> => {
  const prisma = {
    clubVoucherOrder: {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    staff: { findUnique: jest.fn().mockResolvedValue(null) },
    store: { findUnique: jest.fn().mockResolvedValue(null) },
  };
  const realtime = {
    publishVoucherOrderConfirmed: jest.fn(),
    publishVoucherOrderStatusChanged: jest.fn(),
  };
  const commerceAccess = {
    resolveSingleStoreId: jest.fn().mockResolvedValue(1),
    findOperatorStaffIdForStore: jest.fn().mockResolvedValue(null),
  };

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      VoucherOrdersService,
      { provide: PrismaService, useValue: prisma },
      { provide: CommerceAccessService, useValue: commerceAccess },
      { provide: ScanOrderingRealtimeService, useValue: realtime },
      {
        provide: ClubVoucherOrderRefundService,
        useValue: { rejectVoucherOrderByMerchant: jest.fn() },
      },
    ],
  }).compile();

  return { service: module.get(VoucherOrdersService), prisma, realtime };
};

const buildUnconfirmedOrder = (): Record<string, unknown> => ({
  id: 7,
  orderNo: 'VO-1',
  status: 'pending',
  expiresAt: null,
  confirmedAt: null,
  confirmedByStaffName: null,
  confirmedByStaffRole: null,
});

describe('VoucherOrdersService', () => {
  it('无过期订单时只做索引探测，不产生写事务', async () => {
    const { service, prisma } = await createService();

    const result = await service.listVoucherOrders(currentUser, {
      status: VoucherOrderStatusFilter.EXPIRED,
      limit: 20,
      offset: 0,
    });

    expect(prisma.clubVoucherOrder.updateMany).not.toHaveBeenCalled();
    const probeArgs = prisma.clubVoucherOrder.findMany.mock.calls[0][0] as {
      where: { storeId: number; status: string; expiresAt: { lt: Date } };
      select: { id: boolean };
      take: number;
    };
    expect(probeArgs.where.storeId).toBe(1);
    expect(probeArgs.where.status).toBe('pending');
    expect(probeArgs.where.expiresAt.lt).toBeInstanceOf(Date);
    expect(probeArgs.select).toEqual({ id: true });
    expect(probeArgs.take).toBe(EXPIRE_SCAN_BATCH_SIZE);
    expect(result).toEqual({ items: [], total: 0 });
  });

  it('存在过期订单时按批翻转，翻转先于列表查询与 count', async () => {
    const { service, prisma } = await createService();
    prisma.clubVoucherOrder.findMany
      .mockResolvedValueOnce([{ id: 11 }, { id: 12 }])
      .mockResolvedValueOnce([]);
    prisma.clubVoucherOrder.updateMany.mockResolvedValue({ count: 2 });

    await service.listVoucherOrders(currentUser, { limit: 20, offset: 0 });

    const updateArgs = prisma.clubVoucherOrder.updateMany.mock.calls[0][0] as {
      where: { id: { in: number[] }; status: string };
      data: { status: string };
    };
    expect(updateArgs.where.id).toEqual({ in: [11, 12] });
    expect(updateArgs.where.status).toBe('pending');
    expect(updateArgs.data).toEqual({ status: 'expired' });

    // 翻转必须先于查询：否则「已过期」Tab 漏单、total 虚高、下一页 offset 漂移
    const updateOrder =
      prisma.clubVoucherOrder.updateMany.mock.invocationCallOrder[0];
    expect(updateOrder).toBeLessThan(
      prisma.clubVoucherOrder.findMany.mock.invocationCallOrder[1],
    );
    expect(updateOrder).toBeLessThan(
      prisma.clubVoucherOrder.count.mock.invocationCallOrder[0],
    );
  });

  it('惰性过期达到单请求批次上限时停止，剩余留待下次请求', async () => {
    const { service, prisma } = await createService();
    const fullBatch = Array.from(
      { length: EXPIRE_SCAN_BATCH_SIZE },
      (_, index) => ({ id: index + 1 }),
    );
    for (let batch = 0; batch < EXPIRE_SCAN_MAX_BATCHES; batch += 1) {
      prisma.clubVoucherOrder.findMany.mockResolvedValueOnce(fullBatch);
    }
    prisma.clubVoucherOrder.findMany.mockResolvedValueOnce([]);
    prisma.clubVoucherOrder.updateMany.mockResolvedValue({
      count: EXPIRE_SCAN_BATCH_SIZE,
    });

    await service.listVoucherOrders(currentUser, { limit: 20, offset: 0 });

    expect(prisma.clubVoucherOrder.updateMany).toHaveBeenCalledTimes(
      EXPIRE_SCAN_MAX_BATCHES,
    );
    // 10 次探测 + 1 次列表，没有第 11 次探测
    expect(prisma.clubVoucherOrder.findMany).toHaveBeenCalledTimes(
      EXPIRE_SCAN_MAX_BATCHES + 1,
    );
  });

  it('列表与 count 使用显式状态集合而非 not 不等式', async () => {
    const { service, prisma } = await createService();
    const statuses = ['pending', 'used', 'refunded', 'expired'];

    await service.listVoucherOrders(currentUser, {
      status: VoucherOrderStatusFilter.ALL,
      limit: 20,
      offset: 0,
    });

    const listWhere = prisma.clubVoucherOrder.findMany.mock.calls[1][0] as {
      where: { status: { in: string[] } };
    };
    const countWhere = prisma.clubVoucherOrder.count.mock.calls[0][0] as {
      where: { status: { in: string[] } };
    };
    expect(listWhere.where.status.in).toEqual(statuses);
    expect(countWhere.where.status.in).toEqual(statuses);
  });

  it('确认订单只预读必要字段，并用带状态条件的原子更新防并发重复确认', async () => {
    const { service, prisma } = await createService();
    prisma.clubVoucherOrder.findFirst.mockResolvedValue(
      buildUnconfirmedOrder(),
    );
    prisma.clubVoucherOrder.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.confirmVoucherOrder(currentUser, 'VO-1');

    const findArgs = prisma.clubVoucherOrder.findFirst.mock.calls[0][0] as {
      select: Record<string, boolean>;
    };
    expect(findArgs.select).toEqual({
      id: true,
      orderNo: true,
      status: true,
      expiresAt: true,
      confirmedAt: true,
      confirmedByStaffName: true,
      confirmedByStaffRole: true,
    });
    const updateArgs = prisma.clubVoucherOrder.updateMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
    };
    expect(updateArgs.where).toMatchObject({
      id: 7,
      status: 'pending',
      confirmedAt: null,
    });
    expect(prisma.clubVoucherOrder.update).not.toHaveBeenCalled();
    expect(result.status).toBe('pending');
  });

  it('已确认订单直接返回快照，不重复写入也不重复广播', async () => {
    const { service, prisma, realtime } = await createService();
    const confirmedAt = new Date('2026-11-11T02:00:00.000Z');
    prisma.clubVoucherOrder.findFirst.mockResolvedValue({
      ...buildUnconfirmedOrder(),
      confirmedAt,
      confirmedByStaffName: '店长',
      confirmedByStaffRole: 'manager',
    });

    const result = await service.confirmVoucherOrder(currentUser, 'VO-1');

    expect(result.confirmedAt).toBe(confirmedAt.toISOString());
    expect(result.confirmedByStaffName).toBe('店长');
    expect(result.confirmedByStaffRole).toBe('manager');
    expect(prisma.clubVoucherOrder.updateMany).not.toHaveBeenCalled();
    expect(realtime.publishVoucherOrderConfirmed).not.toHaveBeenCalled();
  });

  it('确认被并发抢占时回读最新确认信息，保持幂等语义', async () => {
    const { service, prisma } = await createService();
    const confirmedAt = new Date('2026-11-11T02:00:00.000Z');
    prisma.clubVoucherOrder.findFirst
      .mockResolvedValueOnce(buildUnconfirmedOrder())
      .mockResolvedValueOnce({
        ...buildUnconfirmedOrder(),
        confirmedAt,
        confirmedByStaffName: '收银员',
        confirmedByStaffRole: 'staff',
      });
    prisma.clubVoucherOrder.updateMany.mockResolvedValue({ count: 0 });

    const result = await service.confirmVoucherOrder(currentUser, 'VO-1');

    expect(result.confirmedAt).toBe(confirmedAt.toISOString());
    expect(result.confirmedByStaffName).toBe('收银员');
    expect(prisma.clubVoucherOrder.findFirst).toHaveBeenCalledTimes(2);
  });

  it('抢占后回读仍无确认信息时抛出状态冲突，不返回伪造成功', async () => {
    const { service, prisma } = await createService();
    prisma.clubVoucherOrder.findFirst
      .mockResolvedValueOnce(buildUnconfirmedOrder())
      .mockResolvedValueOnce(buildUnconfirmedOrder());
    prisma.clubVoucherOrder.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.confirmVoucherOrder(currentUser, 'VO-1'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('已过有效期但 DB 状态仍是 pending 的订单不可确认', async () => {
    const { service, prisma } = await createService();
    prisma.clubVoucherOrder.findFirst.mockResolvedValue({
      ...buildUnconfirmedOrder(),
      expiresAt: new Date('2000-01-01T00:00:00.000Z'),
    });

    await expect(
      service.confirmVoucherOrder(currentUser, 'VO-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.clubVoucherOrder.update).not.toHaveBeenCalled();
    expect(prisma.clubVoucherOrder.updateMany).not.toHaveBeenCalled();
  });
});
