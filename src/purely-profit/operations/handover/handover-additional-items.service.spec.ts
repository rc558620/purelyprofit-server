import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';
import { HandoverAdditionalItemsService } from './handover-additional-items.service';
import {
  createHandoverPrismaMock,
  createOwnerUser,
} from './hover.spec-helpers';

describe('HandoverAdditionalItemsService', () => {
  let service: HandoverAdditionalItemsService;

  const prismaService = createHandoverPrismaMock();
  const ownerUser = createOwnerUser();

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HandoverAdditionalItemsService,
        { provide: PrismaService, useValue: prismaService },
      ],
    }).compile();

    service = module.get<HandoverAdditionalItemsService>(
      HandoverAdditionalItemsService,
    );
  });

  describe('listAdditionalItems', () => {
    it('会回填每个附加项最近一次已完成交班的值', async () => {
      prismaService.storeHandoverAdditionalItem.findMany.mockResolvedValue([
        {
          id: 101,
          storeId: 100,
          name: '房卡',
          createdAt: new Date('2026-06-01T10:00:00.000Z'),
          updatedAt: new Date('2026-06-01T10:00:00.000Z'),
        },
        {
          id: 102,
          storeId: 100,
          name: '钥匙',
          createdAt: new Date('2026-06-01T10:01:00.000Z'),
          updatedAt: new Date('2026-06-01T10:01:00.000Z'),
        },
        {
          id: 103,
          storeId: 100,
          name: '备用金',
          createdAt: new Date('2026-06-01T10:02:00.000Z'),
          updatedAt: new Date('2026-06-01T10:02:00.000Z'),
        },
      ]);
      // DISTINCT ON 让 PG 每个附加项只返回最新一行：不再拉全量历史再内存取最新
      prismaService.$queryRaw.mockResolvedValue([
        { itemId: 101, value: '7' },
        { itemId: 102, value: '8' },
      ]);

      const result = await service.listAdditionalItems(ownerUser);

      expect(result.items).toEqual([
        expect.objectContaining({ id: 101, name: '房卡', val: '7' }),
        expect.objectContaining({ id: 102, name: '钥匙', val: '8' }),
        expect.objectContaining({ id: 103, name: '备用金', val: '' }),
      ]);
      expect(prismaService.$queryRaw).toHaveBeenCalledTimes(1);
      const [sqlTemplate] = prismaService.$queryRaw.mock.calls[0];
      expect(String(sqlTemplate)).toContain('DISTINCT ON');
      expect(
        prismaService.storeHandoverAdditionalValue.findMany,
      ).not.toHaveBeenCalled();
    });

    it('没有附加项时不查询最近值', async () => {
      prismaService.storeHandoverAdditionalItem.findMany.mockResolvedValue([]);

      const result = await service.listAdditionalItems(ownerUser);

      expect(result).toEqual({ items: [] });
      expect(prismaService.$queryRaw).not.toHaveBeenCalled();
    });
  });
});
