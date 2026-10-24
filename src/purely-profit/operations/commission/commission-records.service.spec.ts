/**
 * 提成明细导出单测：CSV 表头首列按门店自定义的服务人员称呼生成。
 *
 * 覆盖：
 *  - 正常读取门店称呼时，表头首列为该称呼
 *  - 读取门店称呼失败时回落默认「技师」，不得中断已经加载完成的导出
 */
import { Test, TestingModule } from '@nestjs/testing';
import type { ServerResponse } from 'node:http';
import { PrismaService } from '../../../prisma/prisma.service';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { CommissionCoreService } from './commission-core.service';
import { CommissionRecordsService } from './commission-records.service';

describe('CommissionRecordsService – 导出表头称呼', () => {
  let service: CommissionRecordsService;

  const prismaService = {
    store: {
      findUnique: jest.fn(),
    },
    commissionRecord: {
      findMany: jest.fn(),
      count: jest.fn(),
      groupBy: jest.fn(),
    },
  };

  const commerceAccessService = {
    resolveSingleStoreId: jest.fn().mockResolvedValue(18),
  };

  const coreService = {
    buildServicesMap: jest.fn(),
    resolveTechnicianNames: jest.fn(),
  };

  const buildReply = (): ServerResponse =>
    ({
      setHeader: jest.fn(),
      write: jest.fn(),
      end: jest.fn(),
    }) as unknown as ServerResponse;

  beforeEach(async () => {
    jest.clearAllMocks();

    prismaService.commissionRecord.findMany.mockResolvedValue([
      {
        id: 1,
        storeId: 18,
        sessionId: 2,
        spaceName: 'A01',
        technicianId: 5,
        technicianName: '王强',
        serviceIds: [7],
        serviceNames: ['全身按摩'],
        serviceCommissions: [3000],
        commission: 3000,
        status: 'settled',
        settledAt: new Date('2026-05-10T00:00:00.000Z'),
        month: '2026-05',
        createdAt: new Date('2026-05-10T00:00:00.000Z'),
      },
    ]);
    prismaService.commissionRecord.groupBy.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CommissionRecordsService,
        { provide: PrismaService, useValue: prismaService },
        { provide: CommerceAccessService, useValue: commerceAccessService },
        { provide: CommissionCoreService, useValue: coreService },
      ],
    }).compile();

    service = module.get<CommissionRecordsService>(CommissionRecordsService);
  });

  it('表头首列为门店自定义称呼', async () => {
    prismaService.store.findUnique.mockResolvedValue({
      technicianLabel: '美容师',
    });

    const reply = buildReply();
    await service.streamExportCsv(reply, { id: 1 } as never, {} as never);

    const writtenLines = (reply.write as jest.Mock).mock.calls
      .map((call) => String(call[0]))
      .join('');
    expect(writtenLines).toContain('美容师,空间,服务（每服务提成）');
  });

  it('读取门店称呼失败时回落默认「技师」且不中断导出', async () => {
    prismaService.store.findUnique.mockRejectedValue(new Error('db down'));

    const reply = buildReply();
    await expect(
      service.streamExportCsv(reply, { id: 1 } as never, {} as never),
    ).resolves.toBeUndefined();

    const writtenLines = (reply.write as jest.Mock).mock.calls
      .map((call) => String(call[0]))
      .join('');
    expect(writtenLines).toContain('技师,空间,服务（每服务提成）');
  });
});
