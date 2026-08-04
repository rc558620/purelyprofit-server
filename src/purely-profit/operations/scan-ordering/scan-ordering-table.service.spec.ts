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
  });
});
