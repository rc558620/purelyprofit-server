// 扫码点餐会话自动归档服务单元测试
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';
import { ScanOrderingSessionArchiveService } from './scan-ordering-session-archive.service';

describe('ScanOrderingSessionArchiveService', () => {
  let service: ScanOrderingSessionArchiveService;

  const transaction = {
    scanOrderingSession: {
      findFirst: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
    },
    scanOrders: { findMany: jest.fn(), updateMany: jest.fn() },
    scanOrderStatusHistory: { createMany: jest.fn() },
    scanOrderingCartItem: { updateMany: jest.fn() },
    scanOrderingTable: { updateMany: jest.fn() },
  };
  const prisma = {
    scanOrderingSession: { findMany: jest.fn() },
    $transaction: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(
      async (callback: (tx: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
    );
    transaction.scanOrderingSession.findFirst.mockResolvedValue({ id: 101 });
    transaction.scanOrderingSession.updateMany.mockResolvedValue({ count: 1 });
    transaction.scanOrderingCartItem.updateMany.mockResolvedValue({ count: 0 });
    transaction.scanOrders.updateMany.mockResolvedValue({ count: 1 });
    transaction.scanOrderStatusHistory.createMany.mockResolvedValue({
      count: 1,
    });
    transaction.scanOrderingTable.updateMany.mockResolvedValue({ count: 1 });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScanOrderingSessionArchiveService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(ScanOrderingSessionArchiveService);
  });

  it('无到期会话时不归档任何会话', async () => {
    prisma.scanOrderingSession.findMany.mockResolvedValue([]);

    const count = await service.archiveEligibleSessions(
      new Date('2026-08-20T00:00:00Z'),
    );

    expect(count).toBe(0);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('会话内无订单：不归档', async () => {
    prisma.scanOrderingSession.findMany.mockResolvedValue([
      { id: 101, storeId: 37, tableId: 41 },
    ]);
    transaction.scanOrders.findMany.mockResolvedValue([]);

    const count = await service.archiveEligibleSessions(
      new Date('2026-08-20T00:00:00Z'),
    );

    expect(count).toBe(0);
    expect(transaction.scanOrderingSession.updateMany).not.toHaveBeenCalled();
  });

  it('会话内存在未出餐订单（preparing）：不归档', async () => {
    prisma.scanOrderingSession.findMany.mockResolvedValue([
      { id: 101, storeId: 37, tableId: 41 },
    ]);
    transaction.scanOrders.findMany.mockResolvedValue([
      { id: 500, status: 'preparing', servedAt: null },
    ]);

    const count = await service.archiveEligibleSessions(
      new Date('2026-08-20T00:00:00Z'),
    );

    expect(count).toBe(0);
  });

  it('全部已出餐但最后出餐不足 2 小时：不归档', async () => {
    prisma.scanOrderingSession.findMany.mockResolvedValue([
      { id: 101, storeId: 37, tableId: 41 },
    ]);
    transaction.scanOrders.findMany.mockResolvedValue([
      { id: 500, status: 'served', servedAt: new Date('2026-08-19T23:00:00Z') },
    ]);

    const count = await service.archiveEligibleSessions(
      new Date('2026-08-20T00:00:00Z'),
    );

    expect(count).toBe(0);
  });

  it('全部已出餐且最后出餐超过 2 小时：归档会话并自动完成订单', async () => {
    prisma.scanOrderingSession.findMany.mockResolvedValue([
      { id: 101, storeId: 37, tableId: 41 },
    ]);
    transaction.scanOrders.findMany.mockResolvedValue([
      { id: 500, status: 'served', servedAt: new Date('2026-08-19T20:00:00Z') },
      { id: 501, status: 'served', servedAt: new Date('2026-08-19T21:00:00Z') },
    ]);
    transaction.scanOrderingSession.count.mockResolvedValue(0);

    const count = await service.archiveEligibleSessions(
      new Date('2026-08-20T00:00:00Z'),
    );

    expect(count).toBe(1);
    // 会话归档
    expect(transaction.scanOrderingSession.updateMany).toHaveBeenCalledWith({
      where: { id: 101, status: 'active' },
      data: {
        status: 'checked_out',
        endedAt: expect.any(Date),
        archiveReason: 'auto_timeout',
      },
    });
    // 会话内 served 订单全部置为已完成
    expect(transaction.scanOrders.updateMany).toHaveBeenCalledWith({
      where: { sessionId: 101, deletedAt: null, status: 'served' },
      data: { status: 'completed', completedAt: expect.any(Date) },
    });
    // 补写系统状态历史
    expect(transaction.scanOrderStatusHistory.createMany).toHaveBeenCalledWith({
      data: [
        {
          orderId: 500,
          storeId: 37,
          fromStatus: 'served',
          toStatus: 'completed',
          operatorType: 'system',
          reason: '会话超时归档，订单自动完成',
        },
        {
          orderId: 501,
          storeId: 37,
          fromStatus: 'served',
          toStatus: 'completed',
          operatorType: 'system',
          reason: '会话超时归档，订单自动完成',
        },
      ],
    });
    // 无其他 active 会话时桌台恢复空桌
    expect(transaction.scanOrderingTable.updateMany).toHaveBeenCalledWith({
      where: { id: 41, storeId: 37, status: { not: 'disabled' } },
      data: { status: 'empty', version: { increment: 1 } },
    });
  });

  it('桌台仍有其他 active 会话时归档不重置桌台', async () => {
    prisma.scanOrderingSession.findMany.mockResolvedValue([
      { id: 101, storeId: 37, tableId: 41 },
    ]);
    transaction.scanOrders.findMany.mockResolvedValue([
      { id: 500, status: 'served', servedAt: new Date('2026-08-19T20:00:00Z') },
    ]);
    transaction.scanOrderingSession.count.mockResolvedValue(1);

    const count = await service.archiveEligibleSessions(
      new Date('2026-08-20T00:00:00Z'),
    );

    expect(count).toBe(1);
    expect(transaction.scanOrderingTable.updateMany).not.toHaveBeenCalled();
  });
});
