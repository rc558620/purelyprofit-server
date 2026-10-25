// Pulse / 新客额度变动记录查询服务用例：权限边界、Tab → 流水类型映射、
// 真分页 skip / take 与 hasMore、统计与列表同源。
import { NotFoundException } from '@nestjs/common';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PulseMembershipAdminQuotaLogsService } from './membership-admin-quota-logs.service';

const user: AuthenticatedUser = {
  id: 101,
  email: 'dev@example.com',
  phone: '13800138000',
  name: '开发者',
  createdAt: new Date('2026-05-12T00:00:00.000Z'),
  updatedAt: new Date('2026-05-13T00:00:00.000Z'),
  lastActiveAt: null,
  pulseMode: 'normal',
  isPulseDeveloper: true,
  currentMembership: null,
};

const buildLogRow = (id: number) => ({
  id,
  type: 'admin_adjust',
  changeAmount: 100,
  balanceAfter: 320,
  amountFen: null,
  description: '平台运营发放活动额度',
  createdAt: new Date('2026-09-29T08:56:00.000Z'),
});

const createContext = (
  options: { canAccess?: boolean; storeExists?: boolean } = {},
) => {
  const prisma = {
    store: {
      findFirst: jest
        .fn()
        .mockResolvedValue(options.storeExists === false ? null : { id: 12 }),
    },
    storeNewCustomerQuotaLog: {
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
      groupBy: jest.fn().mockResolvedValue([]),
    },
  };
  const accessService = {
    canAccessAdminMember: jest
      .fn()
      .mockResolvedValue(options.canAccess !== false),
  };

  return {
    prisma,
    accessService,
    service: new PulseMembershipAdminQuotaLogsService(
      prisma as never,
      accessService as never,
    ),
  };
};

describe('PulseMembershipAdminQuotaLogsService', () => {
  it('无权访问目标门店时按「会员不存在」处理，不查询流水', async () => {
    const { prisma, service } = createContext({ canAccess: false });

    await expect(service.listAdminQuotaLogs(user, 12, {})).rejects.toThrow(
      NotFoundException,
    );
    expect(prisma.storeNewCustomerQuotaLog.findMany).not.toHaveBeenCalled();
  });

  it('已注销门店不返回流水', async () => {
    const { prisma, service } = createContext({ storeExists: false });

    await expect(service.listAdminQuotaLogs(user, 12, {})).rejects.toThrow(
      NotFoundException,
    );
    expect(prisma.storeNewCustomerQuotaLog.count).not.toHaveBeenCalled();
  });

  it('管理员调整 Tab 只查 admin_adjust 流水', async () => {
    const { prisma, service } = createContext();
    prisma.storeNewCustomerQuotaLog.count.mockResolvedValue(2);
    prisma.storeNewCustomerQuotaLog.findMany.mockResolvedValue([
      buildLogRow(1),
    ]);
    prisma.storeNewCustomerQuotaLog.groupBy.mockResolvedValue([
      { type: 'admin_adjust', _count: { _all: 2 } },
    ]);

    const result = await service.listAdminQuotaLogs(user, 12, { tab: 'admin' });

    expect(prisma.storeNewCustomerQuotaLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { storeId: 12, type: 'admin_adjust' },
        skip: 0,
        take: 20,
      }),
    );
    expect(result.total).toBe(2);
    expect(result.stats).toEqual({
      totalRecords: 2,
      adminAdjustCount: 2,
      rechargeCount: 0,
      consumeCount: 0,
    });
  });

  it('消耗 Tab 同时覆盖新客消耗与额度清零', async () => {
    const { prisma, service } = createContext();

    await service.listAdminQuotaLogs(user, 12, { tab: 'consume' });

    expect(prisma.storeNewCustomerQuotaLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { storeId: 12, type: { in: ['consume', 'clear'] } },
      }),
    );
  });

  it('第 2 页按 skip / take 真分页，并按总数判断 hasMore', async () => {
    const { prisma, service } = createContext();
    prisma.storeNewCustomerQuotaLog.count.mockResolvedValue(45);

    const result = await service.listAdminQuotaLogs(user, 12, {
      tab: 'all',
      page: 2,
      pageSize: 20,
    });

    expect(prisma.storeNewCustomerQuotaLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 20, take: 20 }),
    );
    expect(result.page).toBe(2);
    expect(result.pageSize).toBe(20);
    expect(result.hasMore).toBe(true);
  });

  it('统计与列表同源：切到充值 Tab 时总记录等于该 Tab 的条数', async () => {
    const { prisma, service } = createContext();
    prisma.storeNewCustomerQuotaLog.count.mockResolvedValue(8);
    prisma.storeNewCustomerQuotaLog.groupBy.mockResolvedValue([
      { type: 'recharge', _count: { _all: 8 } },
    ]);

    const result = await service.listAdminQuotaLogs(user, 12, {
      tab: 'recharge',
    });

    expect(prisma.storeNewCustomerQuotaLog.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: { storeId: 12, type: 'recharge' } }),
    );
    expect(result.stats.totalRecords).toBe(result.total);
    expect(result.stats.rechargeCount).toBe(8);
  });
});
