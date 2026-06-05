import { HandoverStatus } from '@prisma/client';
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
      prismaService.storeHandoverAdditionalValue.findMany.mockResolvedValue([
        { itemId: 101, value: '7' },
        { itemId: 101, value: '6' },
        { itemId: 102, value: '8' },
      ]);

      const result = await service.listAdditionalItems(ownerUser);

      expect(result.items).toEqual([
        expect.objectContaining({ id: 101, name: '房卡', val: '7' }),
        expect.objectContaining({ id: 102, name: '钥匙', val: '8' }),
        expect.objectContaining({ id: 103, name: '备用金', val: '' }),
      ]);
      expect(
        prismaService.storeHandoverAdditionalValue.findMany,
      ).toHaveBeenCalledWith({
        where: {
          itemId: { in: [101, 102, 103] },
          item: { storeId: 100 },
          record: {
            status: HandoverStatus.completed,
          },
        },
        select: {
          itemId: true,
          value: true,
        },
        orderBy: [
          { record: { handoverAt: 'desc' } },
          { record: { createdAt: 'desc' } },
          { createdAt: 'desc' },
          { id: 'desc' },
        ],
      });
    });

    it('没有附加项时不查询最近值', async () => {
      prismaService.storeHandoverAdditionalItem.findMany.mockResolvedValue([]);

      const result = await service.listAdditionalItems(ownerUser);

      expect(result).toEqual({ items: [] });
      expect(
        prismaService.storeHandoverAdditionalValue.findMany,
      ).not.toHaveBeenCalled();
    });
  });
});
