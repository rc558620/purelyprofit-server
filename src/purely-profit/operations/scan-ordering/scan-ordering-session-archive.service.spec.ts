// 扫码点餐会话自动归档服务单元测试
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';
import { ScanOrderingRealtimeService } from '../../../purely-club/scan-ordering/scan-ordering-realtime.service';
import { ScanOrderingPickupNumberService } from '../../../purely-club/scan-ordering/scan-ordering-pickup-number.service';
import { ScanOrderingSessionArchiveService } from './scan-ordering-session-archive.service';

describe('ScanOrderingSessionArchiveService', () => {
  let service: ScanOrderingSessionArchiveService;

  const transaction = {
    scanOrderingSession: {
      findFirst: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
    },
    scanOrders: {
      findMany: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
    },
    scanOrderStatusHistory: { createMany: jest.fn() },
    scanOrderingCartItem: { updateMany: jest.fn() },
    scanOrderingTable: { updateMany: jest.fn() },
  };
  const prisma = {
    scanOrderingSession: { findMany: jest.fn() },
    $transaction: jest.fn(),
  };
  const realtimeService = { publishOrderStatusChanged: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(
      async (callback: (tx: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
    );
    transaction.scanOrderingSession.findFirst.mockResolvedValue({
      id: 101,
      lastActiveAt: new Date('2026-08-19T21:30:00Z'),
      expiresAt: null,
    });
    // 默认无未完结手工录入单（不阻塞归档）
    transaction.scanOrders.count.mockResolvedValue(0);
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
        // 未配置阈值时回落到服务内置默认（2 小时）
        { provide: ConfigService, useValue: { get: () => undefined } },
        { provide: ScanOrderingRealtimeService, useValue: realtimeService },
        {
          provide: ScanOrderingPickupNumberService,
          useValue: {
            formatPickupNumber: (value: number | null) =>
              value === null ? null : String(value).padStart(3, '0'),
          },
        },
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
    // 会话归档（active 与 left 会话均纳入自动归档范围）
    expect(transaction.scanOrderingSession.updateMany).toHaveBeenCalledWith({
      where: { id: 101, status: { in: ['active', 'left'] } },
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

  it('会话内含已退款订单（rejected）不阻塞归档：桌台不再因一笔退款单永久滞留', async () => {
    // 回归真实故障：A01 会话里既有 served 单也有被拒单退款的 rejected 单，
    // 旧实现要求「订单全部 served」，导致该会话永不归档、桌台长期停在用餐中。
    prisma.scanOrderingSession.findMany.mockResolvedValue([
      { id: 101, storeId: 37, tableId: 41 },
    ]);
    transaction.scanOrders.findMany.mockResolvedValue([
      { id: 500, status: 'served', servedAt: new Date('2026-08-19T20:00:00Z') },
      { id: 501, status: 'rejected', servedAt: null },
    ]);
    transaction.scanOrderingSession.count.mockResolvedValue(0);

    const count = await service.archiveEligibleSessions(
      new Date('2026-08-20T00:00:00Z'),
    );

    expect(count).toBe(1);
    // 仅 served 单闭环为 completed，已退款单不动
    expect(transaction.scanOrders.updateMany).toHaveBeenCalledWith({
      where: { sessionId: 101, deletedAt: null, status: 'served' },
      data: { status: 'completed', completedAt: expect.any(Date) },
    });
    expect(transaction.scanOrderingTable.updateMany).toHaveBeenCalledWith({
      where: { id: 41, storeId: 37, status: { not: 'disabled' } },
      data: { status: 'empty', version: { increment: 1 } },
    });
  });

  it('日间（午市）：最后出餐后满阈值即归档，不等会话 TTL 过期', async () => {
    // 12:00 下单、13:00 吃完，会话 16:00 才过期。若把 TTL 计入下限，
    // 桌台要拖到 18:00 才释放；日间口径应只按最后活动（13:00）+ 2h = 15:00 归档。
    prisma.scanOrderingSession.findMany.mockResolvedValue([
      { id: 101, storeId: 37, tableId: 41 },
    ]);
    transaction.scanOrderingSession.findFirst.mockResolvedValue({
      id: 101,
      lastActiveAt: new Date('2026-08-20T04:00:00Z'), // 北京 12:00
      expiresAt: new Date('2026-08-20T08:00:00Z'), // 北京 16:00（尚未过期）
    });
    transaction.scanOrders.findMany.mockResolvedValue([
      {
        id: 500,
        status: 'served',
        servedAt: new Date('2026-08-20T05:00:00Z'), // 北京 13:00
        completedAt: null,
      },
    ]);
    transaction.scanOrderingSession.count.mockResolvedValue(0);

    // 扫描时刻：北京 15:00（会话仍未过期）
    const count = await service.archiveEligibleSessions(
      new Date('2026-08-20T07:00:00Z'),
    );

    expect(count).toBe(1);
  });

  it('日间：最后出餐未达阈值时不归档', async () => {
    prisma.scanOrderingSession.findMany.mockResolvedValue([
      { id: 101, storeId: 37, tableId: 41 },
    ]);
    transaction.scanOrderingSession.findFirst.mockResolvedValue({
      id: 101,
      lastActiveAt: new Date('2026-08-20T04:00:00Z'),
      expiresAt: new Date('2026-08-20T08:00:00Z'),
    });
    transaction.scanOrders.findMany.mockResolvedValue([
      {
        id: 500,
        status: 'served',
        servedAt: new Date('2026-08-20T05:00:00Z'), // 北京 13:00
        completedAt: null,
      },
    ]);

    // 扫描时刻：北京 14:30（距最后出餐仅 1.5h）
    const count = await service.archiveEligibleSessions(
      new Date('2026-08-20T06:30:00Z'),
    );

    expect(count).toBe(0);
    expect(transaction.scanOrderingSession.updateMany).not.toHaveBeenCalled();
  });

  it('跨天长时段用餐：会话尚未过期（23:30 下单、次日 01:35）不归档', async () => {
    // 夜宵/火锅场景：客人还在座，此时清桌会让商家看到「空桌」而去收台。
    // 归档必须以会话过期时间为准，不能只看最后出餐时间。
    prisma.scanOrderingSession.findMany.mockResolvedValue([
      { id: 101, storeId: 37, tableId: 41 },
    ]);
    transaction.scanOrderingSession.findFirst.mockResolvedValue({
      id: 101,
      lastActiveAt: new Date('2026-08-19T15:30:00Z'), // 北京 23:30
      expiresAt: new Date('2026-08-19T19:30:00Z'), // 北京 次日 03:30（TTL 4h）
    });
    transaction.scanOrders.findMany.mockResolvedValue([
      {
        id: 500,
        status: 'served',
        servedAt: new Date('2026-08-19T15:35:00Z'), // 北京 23:35
        completedAt: null,
      },
    ]);

    // 扫描时刻：北京 次日 01:35（最后出餐已过 2h，但会话远未过期）
    const count = await service.archiveEligibleSessions(
      new Date('2026-08-19T17:35:00Z'),
    );

    expect(count).toBe(0);
    expect(transaction.scanOrderingSession.updateMany).not.toHaveBeenCalled();
  });

  it('会话过期超过宽限期后才归档（跨天单在北京次日 05:30 收敛）', async () => {
    prisma.scanOrderingSession.findMany.mockResolvedValue([
      { id: 101, storeId: 37, tableId: 41 },
    ]);
    transaction.scanOrderingSession.findFirst.mockResolvedValue({
      id: 101,
      lastActiveAt: new Date('2026-08-19T15:30:00Z'),
      expiresAt: new Date('2026-08-19T19:30:00Z'), // 北京 次日 03:30
    });
    transaction.scanOrders.findMany.mockResolvedValue([
      {
        id: 500,
        status: 'served',
        servedAt: new Date('2026-08-19T15:35:00Z'),
        completedAt: null,
      },
    ]);
    transaction.scanOrderingSession.count.mockResolvedValue(0);

    // 扫描时刻：北京 次日 05:30（会话过期 03:30 后再过 2h 宽限）
    const count = await service.archiveEligibleSessions(
      new Date('2026-08-19T21:30:00Z'),
    );

    expect(count).toBe(1);
  });

  it('桌台存在未出餐的手工录入单：不自动归档', async () => {
    prisma.scanOrderingSession.findMany.mockResolvedValue([
      { id: 101, storeId: 37, tableId: 41 },
    ]);
    transaction.scanOrderingSession.findFirst.mockResolvedValue({
      id: 101,
      lastActiveAt: new Date('2026-08-19T20:00:00Z'),
      expiresAt: new Date('2026-08-19T20:30:00Z'),
    });
    transaction.scanOrders.findMany.mockResolvedValue([
      { id: 500, status: 'served', servedAt: new Date('2026-08-19T20:00:00Z') },
    ]);
    // 手工录入单未出餐：必须由商家处理，不能被自动清桌埋掉
    transaction.scanOrders.count.mockResolvedValue(1);

    const count = await service.archiveEligibleSessions(
      new Date('2026-08-20T00:00:00Z'),
    );

    expect(count).toBe(0);
    expect(transaction.scanOrderingSession.updateMany).not.toHaveBeenCalled();
  });

  it('归档时把该桌已出餐的手工录入单一并闭环为 completed', async () => {
    prisma.scanOrderingSession.findMany.mockResolvedValue([
      { id: 101, storeId: 37, tableId: 41 },
    ]);
    transaction.scanOrderingSession.findFirst.mockResolvedValue({
      id: 101,
      lastActiveAt: new Date('2026-08-19T20:00:00Z'),
      expiresAt: new Date('2026-08-19T20:30:00Z'),
    });
    transaction.scanOrders.findMany.mockResolvedValue([
      { id: 500, status: 'served', servedAt: new Date('2026-08-19T20:00:00Z') },
    ]);
    transaction.scanOrderingSession.count.mockResolvedValue(0);

    const count = await service.archiveEligibleSessions(
      new Date('2026-08-20T00:00:00Z'),
    );

    expect(count).toBe(1);
    expect(transaction.scanOrders.updateMany).toHaveBeenCalledWith({
      where: {
        storeId: 37,
        tableId: 41,
        manualEntry: true,
        deletedAt: null,
        status: 'served',
      },
      data: { status: 'completed', completedAt: expect.any(Date) },
    });
  });

  it('归档后推送 order.status_changed（completed），商家端与 C 端即时收敛', async () => {
    prisma.scanOrderingSession.findMany.mockResolvedValue([
      { id: 101, storeId: 37, tableId: 41 },
    ]);
    transaction.scanOrders.findMany.mockResolvedValue([
      {
        id: 500,
        status: 'served',
        servedAt: new Date('2026-08-19T20:00:00Z'),
        completedAt: null,
        version: 3,
        paymentStatus: 'paid',
        pickupNumber: 7,
        pickupNumberStatus: 'called',
        pickupCalledAt: new Date('2026-08-19T20:00:30Z'),
        pickupCompletedAt: null,
      },
    ]);
    transaction.scanOrderingSession.count.mockResolvedValue(0);
    const realtime = realtimeService;

    const count = await service.archiveEligibleSessions(
      new Date('2026-08-20T00:00:00Z'),
    );

    expect(count).toBe(1);
    expect(realtime.publishOrderStatusChanged).toHaveBeenCalledTimes(1);
    expect(realtime.publishOrderStatusChanged).toHaveBeenCalledWith(
      expect.objectContaining({
        storeId: 37,
        orderId: 500,
        sessionId: 101,
        status: 'completed',
        paymentStatus: 'paid',
        fulfillmentStatus: 'closed',
        pickupNumberLabel: '007',
      }),
    );
  });

  it('未归档（仍有未履约订单）时不推送任何实时事件', async () => {
    prisma.scanOrderingSession.findMany.mockResolvedValue([
      { id: 101, storeId: 37, tableId: 41 },
    ]);
    transaction.scanOrders.findMany.mockResolvedValue([
      { id: 500, status: 'preparing', servedAt: null },
    ]);
    const realtime = realtimeService;

    await service.archiveEligibleSessions(new Date('2026-08-20T00:00:00Z'));

    expect(realtime.publishOrderStatusChanged).not.toHaveBeenCalled();
  });

  it('重新扫码后被置 left 的旧会话同样会被归档（订单闭环进历史）', async () => {
    // 回归：旧实现只扫 active，重扫转 left 的会话永远轮不到归档，
    // 其中 served 单长期停在「已出餐未完结」。
    prisma.scanOrderingSession.findMany.mockResolvedValue([
      { id: 101, storeId: 37, tableId: 41 },
    ]);
    transaction.scanOrders.findMany.mockResolvedValue([
      { id: 500, status: 'served', servedAt: new Date('2026-08-19T20:00:00Z') },
    ]);
    transaction.scanOrderingSession.count.mockResolvedValue(0);

    const count = await service.archiveEligibleSessions(
      new Date('2026-08-20T00:00:00Z'),
    );

    expect(count).toBe(1);
    expect(transaction.scanOrders.updateMany).toHaveBeenCalledWith({
      where: { sessionId: 101, deletedAt: null, status: 'served' },
      data: { status: 'completed', completedAt: expect.any(Date) },
    });
  });

  it('会话内仍有退款中订单（refunding）：不归档', async () => {
    prisma.scanOrderingSession.findMany.mockResolvedValue([
      { id: 101, storeId: 37, tableId: 41 },
    ]);
    transaction.scanOrders.findMany.mockResolvedValue([
      { id: 500, status: 'served', servedAt: new Date('2026-08-19T20:00:00Z') },
      { id: 501, status: 'refunding', servedAt: null },
    ]);

    const count = await service.archiveEligibleSessions(
      new Date('2026-08-20T00:00:00Z'),
    );

    expect(count).toBe(0);
    expect(transaction.scanOrderingSession.updateMany).not.toHaveBeenCalled();
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
