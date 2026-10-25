// Pulse / 短信钱包变动记录查询服务用例：权限边界、Tab → 流水类型映射、
// 真分页 skip / take 与 hasMore、统计与列表同源。
import { NotFoundException } from '@nestjs/common';
import type { AuthenticatedUser } from '../../../purely-profit/auth/strategies/jwt.strategy';
import { PulseSmsWalletLogsService } from './pulse-sms-wallet-logs.service';

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

const buildLogRow = (id: number, type = 'grant') => ({
  id,
  type,
  changeFen: 10000,
  balanceAfterFen: 16000,
  description: '客服补偿短信额度',
  orderNo: null,
  broadcastId: null,
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
    smsWalletLog: {
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
    service: new PulseSmsWalletLogsService(
      prisma as never,
      accessService as never,
    ),
  };
};

describe('PulseSmsWalletLogsService', () => {
  it('无权访问目标门店时不查询流水', async () => {
    const { prisma, service } = createContext({ canAccess: false });

    await expect(service.listAdminSmsWalletLogs(user, 12, {})).rejects.toThrow(
      NotFoundException,
    );
    expect(prisma.smsWalletLog.findMany).not.toHaveBeenCalled();
  });

  it('已注销门店不返回流水', async () => {
    const { prisma, service } = createContext({ storeExists: false });

    await expect(service.listAdminSmsWalletLogs(user, 12, {})).rejects.toThrow(
      NotFoundException,
    );
    expect(prisma.smsWalletLog.count).not.toHaveBeenCalled();
  });

  it('平台调整 Tab 同时覆盖赠送与回收', async () => {
    const { prisma, service } = createContext();

    await service.listAdminSmsWalletLogs(user, 12, { tab: 'admin' });

    expect(prisma.smsWalletLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { storeId: 12, type: { in: ['grant', 'admin_adjust'] } },
      }),
    );
  });

  it('退费 Tab 只查 refund 流水', async () => {
    const { prisma, service } = createContext();

    await service.listAdminSmsWalletLogs(user, 12, { tab: 'refund' });

    expect(prisma.smsWalletLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { storeId: 12, type: 'refund' } }),
    );
  });

  it('第 2 页按 skip / take 真分页，并按总数判断 hasMore', async () => {
    const { prisma, service } = createContext();
    prisma.smsWalletLog.count.mockResolvedValue(45);

    const result = await service.listAdminSmsWalletLogs(user, 12, {
      tab: 'all',
      page: 2,
      pageSize: 20,
    });

    expect(prisma.smsWalletLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 20, take: 20 }),
    );
    expect(result.page).toBe(2);
    expect(result.pageSize).toBe(20);
    expect(result.hasMore).toBe(true);
  });

  it('最后一页刚好填满时 hasMore 为 false', async () => {
    const { prisma, service } = createContext();
    prisma.smsWalletLog.count.mockResolvedValue(40);

    const result = await service.listAdminSmsWalletLogs(user, 12, {
      tab: 'all',
      page: 2,
      pageSize: 20,
    });

    expect(result.hasMore).toBe(false);
  });

  it('统计与列表同源：切到充值 Tab 时总记录等于该 Tab 的条数', async () => {
    const { prisma, service } = createContext();
    prisma.smsWalletLog.count.mockResolvedValue(8);
    prisma.smsWalletLog.groupBy.mockResolvedValue([
      { type: 'recharge', _count: { _all: 8 } },
    ]);

    const result = await service.listAdminSmsWalletLogs(user, 12, {
      tab: 'recharge',
    });

    expect(prisma.smsWalletLog.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: { storeId: 12, type: 'recharge' } }),
    );
    expect(result.stats.totalRecords).toBe(result.total);
    expect(result.stats.rechargeCount).toBe(8);
  });

  it('平台调整统计合并赠送与回收两类流水', async () => {
    const { prisma, service } = createContext();
    prisma.smsWalletLog.groupBy.mockResolvedValue([
      { type: 'grant', _count: { _all: 3 } },
      { type: 'admin_adjust', _count: { _all: 2 } },
      { type: 'consume', _count: { _all: 4 } },
    ]);

    const result = await service.listAdminSmsWalletLogs(user, 12, {});

    expect(result.stats).toEqual({
      totalRecords: 9,
      adminAdjustCount: 5,
      rechargeCount: 0,
      consumeCount: 4,
      refundCount: 0,
    });
  });

  it('超上限的 pageSize 被截断到 100', async () => {
    const { prisma, service } = createContext();

    const result = await service.listAdminSmsWalletLogs(user, 12, {
      pageSize: 5000,
    });

    expect(result.pageSize).toBe(100);
    expect(prisma.smsWalletLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 100 }),
    );
  });

  it('流水行映射：时间戳转毫秒，关联单号按可空返回', async () => {
    const { prisma, service } = createContext();
    prisma.smsWalletLog.findMany.mockResolvedValue([
      {
        ...buildLogRow(7, 'consume'),
        orderNo: null,
        broadcastId: 'bc_1a2b3c4d5e6f7081',
      },
    ]);

    const result = await service.listAdminSmsWalletLogs(user, 12, {});

    expect(result.items[0]).toEqual({
      id: '7',
      storeId: '12',
      type: 'consume',
      changeFen: 10000,
      balanceAfterFen: 16000,
      description: '客服补偿短信额度',
      orderNo: null,
      broadcastId: 'bc_1a2b3c4d5e6f7081',
      createdAt: new Date('2026-09-29T08:56:00.000Z').getTime(),
    });
  });
});
