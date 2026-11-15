// 库存流水游标分页回归：双路径 SQL 形态、独立 count、响应游标
import { BadRequestException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { CommerceAccessService } from '../../commerce/commerce-access.service';
import type { PlatformMembershipAccessService } from '../../member/platform-membership/platform-membership-access.service';
import { InventoryReadService } from './inventory-read.service';
import { queryInventoryAdjustmentPage } from './inventory.query';
import {
  decodeCursor,
  encodeCursor,
} from '../../../shared/cursor-pagination.utils';

const createdAt = new Date('2026-11-11T02:00:00.000Z');
const user = {} as AuthenticatedUser;

/** 原生 SQL 的模板字符串片段（插值参数不在其中） */
const sqlOf = (queryRaw: jest.Mock, callIndex = 0): string =>
  (queryRaw.mock.calls[callIndex][0] as unknown as string[]).join(' ');

/** 作为插值参数传入的 Prisma.Sql 片段 */
const fragmentsOf = (queryRaw: jest.Mock, callIndex = 0): string =>
  (queryRaw.mock.calls[callIndex].slice(1) as unknown[])
    .filter(
      (value): value is { sql: string } =>
        typeof value === 'object' && value !== null && 'sql' in value,
    )
    .map((value) => value.sql)
    .join(' | ');

const buildAdjustmentRow = (id: number) => ({
  id,
  productId: 1,
  productName: '可乐',
  beforeStock: 10,
  afterStock: 15,
  delta: 5,
  adjustType: 'restock',
  note: null,
  purchaseOrderId: null,
  createdAt,
});

describe('queryInventoryAdjustmentPage', () => {
  it('offset 路径保持单趟窗口计数', async () => {
    const queryRaw = jest
      .fn()
      .mockResolvedValue([{ ...buildAdjustmentRow(9), totalCount: 12 }]);

    const result = await queryInventoryAdjustmentPage(
      { $queryRaw: queryRaw } as unknown as PrismaService,
      { storeId: 18, query: {}, skip: 20, take: 10 },
    );

    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(sqlOf(queryRaw, 0)).toContain('COUNT(*) OVER()');
    expect(sqlOf(queryRaw, 0)).toContain('OFFSET');
    expect(result.total).toBe(12);
    expect(result.items).toHaveLength(1);
  });

  it('游标路径改为两趟：列表不带窗口计数 + 独立全量 count', async () => {
    const queryRaw = jest
      .fn()
      .mockResolvedValueOnce([buildAdjustmentRow(4), buildAdjustmentRow(3)])
      .mockResolvedValueOnce([{ total: 12 }]);

    const result = await queryInventoryAdjustmentPage(
      { $queryRaw: queryRaw } as unknown as PrismaService,
      {
        storeId: 18,
        query: {},
        skip: 0,
        take: 2,
        cursor: { createdAt, id: 9 },
      },
    );

    expect(queryRaw).toHaveBeenCalledTimes(2);
    // 游标路径不能用窗口计数：它会连游标条件一起统计，total 会随翻页变小
    expect(sqlOf(queryRaw, 0)).not.toContain('COUNT(*) OVER()');
    expect(sqlOf(queryRaw, 0)).not.toContain('OFFSET');
    expect(fragmentsOf(queryRaw, 0)).toContain('created_at <');
    expect(fragmentsOf(queryRaw, 0)).toContain('id <');
    // count 仍保留门店与筛选条件，只是不带游标
    expect(sqlOf(queryRaw, 1)).toContain('COUNT(*)');
    expect(fragmentsOf(queryRaw, 1)).toContain('store_id =');
    expect(result.total).toBe(12);
  });
});

describe('InventoryReadService.listAdjustments 游标分页', () => {
  const buildService = (): {
    service: InventoryReadService;
    queryRaw: jest.Mock;
  } => {
    const queryRaw = jest.fn();
    const configService = {
      get: jest.fn((key: string) => {
        if (key === 'app.defaultPageSize') return 20;
        if (key === 'app.maxPageSize') return 100;
        return undefined;
      }),
    };
    const commerceAccess = {
      resolveViewStoreId: jest.fn().mockResolvedValue(18),
    };

    const service = new InventoryReadService(
      { $queryRaw: queryRaw } as unknown as PrismaService,
      configService as unknown as ConfigService,
      commerceAccess as unknown as CommerceAccessService,
      {} as unknown as PlatformMembershipAccessService,
    );

    return { service, queryRaw };
  };

  it('游标路径：探测行被截断，返回 nextCursor 与全量 total', async () => {
    const { service, queryRaw } = buildService();
    queryRaw
      .mockResolvedValueOnce([buildAdjustmentRow(4), buildAdjustmentRow(3)])
      .mockResolvedValueOnce([{ total: 12 }]);

    const result = await service.listAdjustments(user, {
      pageSize: 1,
      cursor: encodeCursor({ keys: [createdAt.getTime()], id: 9 }),
    });

    expect(result.items.map((item) => item.id)).toEqual(['4']);
    expect(result.meta.total).toBe(12);
    expect(result.hasMore).toBe(true);
    expect(decodeCursor(result.nextCursor)?.id).toBe(4);
  });

  it('offset 兼容路径：hasMore 由 total 推导', async () => {
    const { service, queryRaw } = buildService();
    queryRaw.mockResolvedValueOnce([
      { ...buildAdjustmentRow(9), totalCount: 12 },
    ]);

    const result = await service.listAdjustments(user, {
      page: 2,
      pageSize: 10,
    });

    expect(result.meta).toEqual({
      page: 2,
      pageSize: 10,
      total: 12,
      totalPages: 2,
    });
    // 10 + 1 < 12
    expect(result.hasMore).toBe(true);
    expect(decodeCursor(result.nextCursor)?.id).toBe(9);
  });

  it('非法 cursor 抛 400，且不查库', async () => {
    const { service, queryRaw } = buildService();

    await expect(
      service.listAdjustments(user, { cursor: 'v1:broken' }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(queryRaw).not.toHaveBeenCalled();
  });
});
