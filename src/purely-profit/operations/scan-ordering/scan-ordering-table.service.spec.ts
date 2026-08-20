import { ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { ScanOrderingQrService } from './scan-ordering-qr.service';
import { ScanOrderingTableQueryService } from './scan-ordering-table-query.service';
import { ScanOrderingTableService } from './scan-ordering-table.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';

describe('ScanOrderingTableService', () => {
  let service: ScanOrderingTableService;

  const user = { id: 1, role: 'store_owner' } as AuthenticatedUser;
  const transaction = {
    scanOrderingTable: { findFirst: jest.fn(), update: jest.fn() },
    scanOrderingSession: { findMany: jest.fn(), updateMany: jest.fn() },
    scanOrders: { findMany: jest.fn(), updateMany: jest.fn() },
    scanOrderingCartItem: { updateMany: jest.fn() },
  };
  const prisma = {
    scanOrderingTable: { findMany: jest.fn() },
    $transaction: jest.fn(),
  };
  const commerceAccess = { resolveSingleStoreId: jest.fn() };
  const qrService = { createInitialQrCode: jest.fn() };
  const tableQueryService = { listTables: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    transaction.scanOrderingTable.findFirst.mockResolvedValue({ id: 10 });
    transaction.scanOrderingSession.findMany.mockResolvedValue([{ id: 101 }]);
    transaction.scanOrders.findMany.mockResolvedValue([]);
    prisma.$transaction.mockImplementation(
      async (callback: (tx: typeof transaction) => Promise<void>) =>
        callback(transaction),
    );
    commerceAccess.resolveSingleStoreId.mockResolvedValue(1);
    tableQueryService.listTables.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScanOrderingTableService,
        { provide: PrismaService, useValue: prisma },
        { provide: CommerceAccessService, useValue: commerceAccess },
        { provide: ScanOrderingQrService, useValue: qrService },
        { provide: ScanOrderingTableQueryService, useValue: tableQueryService },
      ],
    }).compile();
    service = module.get(ScanOrderingTableService);
  });

  describe('listTables', () => {
    it('委托给 ScanOrderingTableQueryService 并透传结果', async () => {
      const expected = [{ id: 10, tableCode: 'A01' }];
      tableQueryService.listTables.mockResolvedValue(expected);

      const result = await service.listTables(user);

      expect(tableQueryService.listTables).toHaveBeenCalledWith(user);
      expect(result).toBe(expected);
    });
  });

  describe('clearTable', () => {
    it('退款订单不阻塞清桌，且归档 active 与 left 会话', async () => {
      await expect(service.clearTable(user, 10)).resolves.toBeUndefined();

      expect(transaction.scanOrderingSession.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'active' }),
        }),
      );
      expect(transaction.scanOrderingSession.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: { in: ['active', 'left'] },
          }),
        }),
      );
      expect(transaction.scanOrderingTable.update).toHaveBeenCalled();
    });

    it('待接单订单阻塞清桌', async () => {
      transaction.scanOrders.findMany.mockResolvedValue([
        { status: 'pending_acceptance' },
      ]);

      await expect(service.clearTable(user, 10)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(transaction.scanOrderingSession.updateMany).not.toHaveBeenCalled();
    });

    it('无扫码会话但存在已出餐手工单：允许清桌并将手工单置为已完成', async () => {
      transaction.scanOrderingSession.findMany.mockResolvedValue([]);
      // 第一次 findMany：手工单轮次查询；第二次：会话内订单查询
      transaction.scanOrders.findMany
        .mockResolvedValueOnce([{ status: 'served' }])
        .mockResolvedValueOnce([]);

      await expect(service.clearTable(user, 10)).resolves.toBeUndefined();

      // 手工单轮次查询条件：限定手工单 + 轮次状态（含已完结，与前端口径一致）
      expect(transaction.scanOrders.findMany).toHaveBeenNthCalledWith(1, {
        where: {
          storeId: 1,
          tableId: 10,
          manualEntry: true,
          deletedAt: null,
          status: {
            in: ['pending_acceptance', 'preparing', 'served', 'completed'],
          },
        },
        select: { status: true },
      });
      // 清桌时手工单（sessionId=null）单独置为已完成
      expect(transaction.scanOrders.updateMany).toHaveBeenCalledWith({
        where: {
          storeId: 1,
          tableId: 10,
          manualEntry: true,
          deletedAt: null,
          status: 'served',
        },
        data: { status: 'completed', completedAt: expect.any(Date) },
      });
      expect(transaction.scanOrderingTable.update).toHaveBeenCalled();
    });

    it('无扫码会话且无手工单：拒绝清桌', async () => {
      transaction.scanOrderingSession.findMany.mockResolvedValue([]);
      transaction.scanOrders.findMany.mockResolvedValue([]);

      await expect(service.clearTable(user, 10)).rejects.toThrow(
        '当前桌台不存在有效用餐会话，无法清桌',
      );
      expect(transaction.scanOrderingTable.update).not.toHaveBeenCalled();
    });

    it('手工单未出餐阻塞清桌', async () => {
      transaction.scanOrderingSession.findMany.mockResolvedValue([]);
      transaction.scanOrders.findMany
        .mockResolvedValueOnce([{ status: 'pending_acceptance' }])
        .mockResolvedValueOnce([]);

      await expect(service.clearTable(user, 10)).rejects.toThrow(
        '当前桌台仍有 1 笔订单未出餐',
      );
      expect(transaction.scanOrderingTable.update).not.toHaveBeenCalled();
    });

    it('无扫码会话且手工单已全部完结：仍允许清桌（已完结不阻塞）', async () => {
      transaction.scanOrderingSession.findMany.mockResolvedValue([]);
      transaction.scanOrders.findMany
        .mockResolvedValueOnce([{ status: 'completed' }])
        .mockResolvedValueOnce([]);

      await expect(service.clearTable(user, 10)).resolves.toBeUndefined();
      expect(transaction.scanOrderingTable.update).toHaveBeenCalled();
    });

    it('扫码会话与手工单混合：已出餐手工单一并置为已完成', async () => {
      transaction.scanOrderingSession.findMany.mockResolvedValue([{ id: 101 }]);
      transaction.scanOrders.findMany
        .mockResolvedValueOnce([{ status: 'served' }])
        .mockResolvedValueOnce([{ status: 'served' }]);

      await expect(service.clearTable(user, 10)).resolves.toBeUndefined();

      // 手工单更新与扫码会话订单更新各一次
      const manualEntryUpdate =
        transaction.scanOrders.updateMany.mock.calls.find(
          ([args]: Array<{ where: Record<string, unknown> }>) =>
            args.where.manualEntry === true,
        );
      expect(manualEntryUpdate).toBeDefined();
    });
  });
});
