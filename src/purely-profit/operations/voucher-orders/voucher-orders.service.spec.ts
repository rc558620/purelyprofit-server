// 商家端团购券订单服务回归用例：列表惰性过期与分页口径、已失效券确认拦截。
import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { PrismaService } from '../../../prisma/prisma.service';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { ScanOrderingRealtimeService } from '../../../purely-club/scan-ordering/scan-ordering-realtime.service';
import { ClubVoucherOrderRefundService } from '../../../purely-club/voucher-orders/club-voucher-order-refund.service';
import { VoucherOrdersService } from './voucher-orders.service';
import { VoucherOrderStatusFilter } from './dto/voucher-order-management.dto';

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
  const commerceAccess = {
    resolveSingleStoreId: jest.fn().mockResolvedValue(1),
    findOperatorStaffIdForStore: jest.fn().mockResolvedValue(null),
  };

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      VoucherOrdersService,
      { provide: PrismaService, useValue: prisma },
      { provide: CommerceAccessService, useValue: commerceAccess },
      {
        provide: ScanOrderingRealtimeService,
        useValue: {
          publishVoucherOrderConfirmed: jest.fn(),
          publishVoucherOrderStatusChanged: jest.fn(),
        },
      },
      {
        provide: ClubVoucherOrderRefundService,
        useValue: { rejectVoucherOrderByMerchant: jest.fn() },
      },
    ],
  }).compile();

  return { service: module.get(VoucherOrdersService), prisma };
};

describe('VoucherOrdersService', () => {
  it('列表查询前先按门店批量翻转过期订单，count 与 findMany 共用同一 where', async () => {
    const { service, prisma } = await createService();

    const result = await service.listVoucherOrders(currentUser, {
      status: VoucherOrderStatusFilter.EXPIRED,
      limit: 20,
      offset: 0,
    });

    expect(prisma.clubVoucherOrder.updateMany).toHaveBeenCalledTimes(1);
    const updateArgs = prisma.clubVoucherOrder.updateMany.mock.calls[0][0] as {
      where: { storeId: number; status: string; expiresAt: { lt: Date } };
      data: { status: string };
    };
    expect(updateArgs.where.storeId).toBe(1);
    expect(updateArgs.where.status).toBe('pending');
    expect(updateArgs.where.expiresAt.lt).toBeInstanceOf(Date);
    expect(updateArgs.data).toEqual({ status: 'expired' });

    // 翻转必须先于查询：否则「已过期」Tab 漏单、total 虚高、下一页 offset 漂移
    const updateOrder =
      prisma.clubVoucherOrder.updateMany.mock.invocationCallOrder[0];
    expect(updateOrder).toBeLessThan(
      prisma.clubVoucherOrder.findMany.mock.invocationCallOrder[0],
    );
    expect(updateOrder).toBeLessThan(
      prisma.clubVoucherOrder.count.mock.invocationCallOrder[0],
    );

    expect(result).toEqual({ items: [], total: 0 });
  });

  it('已过有效期但 DB 状态仍是 pending 的订单不可确认', async () => {
    const { service, prisma } = await createService();
    prisma.clubVoucherOrder.findFirst.mockResolvedValue({
      orderNo: 'VO-1',
      status: 'pending',
      expiresAt: new Date('2000-01-01T00:00:00.000Z'),
      confirmedAt: null,
    });

    await expect(
      service.confirmVoucherOrder(currentUser, 'VO-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.clubVoucherOrder.update).not.toHaveBeenCalled();
  });
});
