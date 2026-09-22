import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { ScanOrderingQrService } from './scan-ordering-qr.service';
import { ScanOrderingTableQueryService } from './scan-ordering-table-query.service';
import { ScanOrderingTableClearService } from './scan-ordering-table-clear.service';
import { ScanOrderingTableService } from './scan-ordering-table.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';

describe('ScanOrderingTableService', () => {
  let service: ScanOrderingTableService;

  const user = { id: 1, role: 'store_owner' } as unknown as AuthenticatedUser;
  const transaction = {
    scanOrderingTable: { update: jest.fn(), updateMany: jest.fn() },
    scanOrderingTableQrCode: { updateMany: jest.fn() },
  };
  const prisma = {
    scanOrderingTable: {
      create: jest.fn(),
      findFirst: jest.fn(),
      updateMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  const commerceAccess = { resolveSingleStoreId: jest.fn() };
  const qrService = { createInitialQrCode: jest.fn() };
  const tableQueryService = { listTables: jest.fn() };
  const tableClearService = { clearTable: jest.fn() };

  const uniqueConflict = Object.assign(new Error('Unique constraint'), {
    code: 'P2002',
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(
      async (callback: (tx: typeof transaction) => Promise<void>) =>
        callback(transaction),
    );
    commerceAccess.resolveSingleStoreId.mockResolvedValue(1);
    qrService.createInitialQrCode.mockResolvedValue({ code: 'QR-1' });
    tableQueryService.listTables.mockResolvedValue([]);
    tableClearService.clearTable.mockResolvedValue(undefined);
    transaction.scanOrderingTable.updateMany.mockResolvedValue({ count: 1 });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScanOrderingTableService,
        { provide: PrismaService, useValue: prisma },
        { provide: CommerceAccessService, useValue: commerceAccess },
        { provide: ScanOrderingQrService, useValue: qrService },
        { provide: ScanOrderingTableQueryService, useValue: tableQueryService },
        { provide: ScanOrderingTableClearService, useValue: tableClearService },
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
    it('委托给 ScanOrderingTableClearService', async () => {
      await expect(service.clearTable(user, 10)).resolves.toBeUndefined();

      expect(tableClearService.clearTable).toHaveBeenCalledWith(user, 10);
    });
  });

  describe('createTable', () => {
    it('创建桌台并返回自动生成的首个桌码', async () => {
      prisma.scanOrderingTable.create.mockResolvedValue({
        id: 10,
        tableCode: 'A01',
        name: '一号桌',
        status: 'empty',
        areaId: 2,
        typeId: 3,
      });

      const result = await service.createTable(user, {
        tableCode: 'A01',
        name: '一号桌',
      });

      expect(qrService.createInitialQrCode).toHaveBeenCalledWith(1, 10);
      expect(result).toEqual(
        expect.objectContaining({
          id: 10,
          tableCode: 'A01',
          activeOrderCount: 0,
          qrCode: { code: 'QR-1' },
        }),
      );
    });

    it('唯一约束冲突且存在已禁用记录：复用该记录并重建桌码', async () => {
      prisma.scanOrderingTable.create.mockRejectedValue(uniqueConflict);
      prisma.scanOrderingTable.findFirst.mockResolvedValue({ id: 20 });
      transaction.scanOrderingTable.update.mockResolvedValue({
        id: 20,
        tableCode: 'A01',
        name: '一号桌',
        status: 'empty',
        areaId: null,
        typeId: null,
      });

      const result = await service.createTable(user, {
        tableCode: 'A01',
        name: '一号桌',
      });

      expect(transaction.scanOrderingTableQrCode.updateMany).toHaveBeenCalled();
      expect(result.id).toBe(20);
      expect(qrService.createInitialQrCode).toHaveBeenCalledWith(1, 20);
    });

    it('唯一约束冲突且无已禁用记录：抛出冲突', async () => {
      prisma.scanOrderingTable.create.mockRejectedValue(uniqueConflict);
      prisma.scanOrderingTable.findFirst.mockResolvedValue(null);

      await expect(
        service.createTable(user, { tableCode: 'A01', name: '一号桌' }),
      ).rejects.toThrow('桌台编号已存在');
    });

    it('非唯一约束错误直接抛出', async () => {
      prisma.scanOrderingTable.create.mockRejectedValue(new Error('boom'));

      await expect(
        service.createTable(user, { tableCode: 'A01', name: '一号桌' }),
      ).rejects.toThrow('boom');
    });
  });

  describe('removeTable', () => {
    it('软删除桌台并吊销其活跃桌码', async () => {
      await expect(service.removeTable(user, 10)).resolves.toBeUndefined();

      expect(transaction.scanOrderingTable.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 10, storeId: 1, deletedAt: null },
        }),
      );
      expect(transaction.scanOrderingTableQrCode.updateMany).toHaveBeenCalled();
    });

    it('桌台不存在时抛出未找到', async () => {
      transaction.scanOrderingTable.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.removeTable(user, 10)).rejects.toThrow(
        '扫码点餐桌台不存在',
      );
    });
  });

  describe('updateTable', () => {
    it('桌台不存在时抛出未找到', async () => {
      prisma.scanOrderingTable.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.updateTable(user, 10, { name: '二号桌' }),
      ).rejects.toThrow('扫码点餐桌台不存在');
    });

    it('停用桌台时同步置为 disabled', async () => {
      prisma.scanOrderingTable.updateMany.mockResolvedValue({ count: 1 });

      await service.updateTable(user, 10, { isActive: false });

      expect(prisma.scanOrderingTable.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            isActive: false,
            status: 'disabled',
          }),
        }),
      );
    });
  });
});
