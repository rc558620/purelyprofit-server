import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { ClubVoucherOrderQueryService } from './club-voucher-order-query.service';
import { VOUCHER_ORDER_SORT_MAP } from './club-voucher-order-query.helper';
import type { ClubCurrentContext } from '../stores/club-stores.types';
import {
  decodeClubCursor,
  encodeClubCursor,
} from '../shared/club-keyset-cursor.util';

const buildContext = (): ClubCurrentContext =>
  ({
    user: { id: 201, phone: '13800138000' },
    store: { id: 11, name: '望京店' },
  }) as unknown as ClubCurrentContext;

/** 券订单列表行（与 VOUCHER_ORDER_LIST_SELECT 白名单一致） */
const buildRow = (
  id: number,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  id,
  storeId: 11,
  productId: 7,
  orderNo: `VO${id}`,
  voucherCode: `VC${id}`,
  platform: 'douyin',
  productName: '双人套餐',
  quantity: 1,
  personCount: 2,
  originalAmountFen: 20_000,
  discountAmountFen: 2_000,
  paidAmountFen: 18_000,
  status: 'pending',
  expiresAt: new Date('2026-12-31T00:00:00.000Z'),
  createdAt: new Date(1_761_100_000_000),
  usedAt: null,
  verifyAt: null,
  refundAt: null,
  ...overrides,
});

describe('ClubVoucherOrderQueryService · keyset 分页', () => {
  let service: ClubVoucherOrderQueryService;

  const prismaService = {
    clubVoucherOrder: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      updateMany: jest.fn(),
    },
    marketingProduct: { findMany: jest.fn() },
    store: { findMany: jest.fn() },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClubVoucherOrderQueryService,
        { provide: PrismaService, useValue: prismaService },
      ],
    }).compile();

    service = module.get<ClubVoucherOrderQueryService>(
      ClubVoucherOrderQueryService,
    );

    prismaService.marketingProduct.findMany.mockResolvedValue([
      { id: 7, image: 'https://cdn.example.com/1.jpg' },
    ]);
    prismaService.store.findMany.mockResolvedValue([
      { id: 11, name: '望京店' },
    ]);
  });

  it('排序声明与游标键同序：末位 id 兜底、可空键 NULLS LAST', () => {
    for (const [, spec] of Object.entries(VOUCHER_ORDER_SORT_MAP)) {
      expect(spec.orderBy).toHaveLength(spec.keys.length + 1);
      expect(spec.orderBy[spec.orderBy.length - 1]).toEqual({ id: 'desc' });

      spec.keys.forEach((key, index) => {
        const orderEntry = spec.orderBy[index];
        expect(Object.keys(orderEntry)).toEqual([key.field]);
        const value = Object.values(orderEntry)[0];
        if (key.nullable) {
          expect(value).toEqual({ sort: 'desc', nulls: 'last' });
        } else {
          expect(value).toBe('desc');
        }
      });
    }
  });

  it('首屏不带游标条件，多取一行判末页', async () => {
    prismaService.clubVoucherOrder.findMany.mockResolvedValue([buildRow(1)]);

    const result = await service.listVoucherOrders(buildContext(), {});

    const findManyArg =
      prismaService.clubVoucherOrder.findMany.mock.calls[0][0];
    expect(findManyArg).toMatchObject({
      where: { userId: 201, status: { not: 'unpaid' } },
      orderBy: VOUCHER_ORDER_SORT_MAP.all.orderBy,
      take: 21,
    });
    expect(findManyArg).not.toHaveProperty('skip');
    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeNull();
  });

  it('翻页把游标条件放进 AND，不与状态筛选的 OR 互相覆盖', async () => {
    const createdAt = new Date(1_761_100_000_000);
    const cursor = encodeClubCursor([createdAt], 18);
    prismaService.clubVoucherOrder.findMany.mockResolvedValue([]);

    await service.listVoucherOrders(buildContext(), {
      status: 'pending',
      cursor,
    });

    const where =
      prismaService.clubVoucherOrder.findMany.mock.calls[0][0].where;
    expect(where.AND).toHaveLength(2);
    // [0] 状态筛选（自身含 OR），[1] 游标条件
    expect(where.AND[0]).toHaveProperty('OR');
    expect(where.AND[1]).toEqual({
      OR: [{ createdAt: { lt: createdAt } }, { createdAt, id: { lt: 18 } }],
    });
  });

  it('读接口不写库：已过期的 pending 单只在返回态派生为 expired', async () => {
    const overdue = buildRow(2, {
      status: 'pending',
      expiresAt: new Date(1_700_000_000_000),
    });
    prismaService.clubVoucherOrder.findMany.mockResolvedValue([overdue]);

    const result = await service.listVoucherOrders(buildContext(), {});

    expect(prismaService.clubVoucherOrder.updateMany).not.toHaveBeenCalled();
    expect(result.items[0]).toMatchObject({
      status: 'expired',
      statusLabel: '已过期',
      // 金额口径不变：过期只影响状态与文案
      paidAmountFen: 18_000,
      originalAmountFen: 20_000,
      discountAmountFen: 2_000,
    });
  });

  it('详情读同样不写库，过期券返回 expired', async () => {
    prismaService.clubVoucherOrder.findFirst.mockResolvedValue(
      buildRow(3, {
        status: 'pending',
        expiresAt: new Date(1_700_000_000_000),
        paymentChannel: 'wechat',
        usedStoreId: null,
        refundAmountFen: null,
        pointsDeductFen: 0,
        pointsUsed: 0,
        remark: null,
        breakdownItems: null,
      }),
    );

    const detail = await service.getVoucherOrderDetail(buildContext(), 'VO3');

    expect(prismaService.clubVoucherOrder.updateMany).not.toHaveBeenCalled();
    expect(detail).toMatchObject({ status: 'expired', statusLabel: '已过期' });
  });

  it('按券码查询同样只派生状态，不写库', async () => {
    prismaService.clubVoucherOrder.findFirst.mockResolvedValue({
      id: 4,
      storeId: 11,
      productName: '双人套餐',
      personCount: 2,
      guestName: '张三',
      guestPhone: '13800138000',
      guestType: 'member',
      paidAmountFen: 18_000,
      status: 'pending',
      expiresAt: new Date(1_700_000_000_000),
      usedSessionId: null,
      quantity: 1,
    });

    const found = await service.findByVoucherCode('VC4', 11);

    expect(prismaService.clubVoucherOrder.updateMany).not.toHaveBeenCalled();
    expect(found?.status).toBe('expired');
    expect(found?.paidAmountFen).toBe(18_000);
  });

  it('有下一页时按当前 Tab 的排序键编码游标（refunded 用 refundAt）', async () => {
    const refundedAt = new Date(1_761_050_000_000);
    const rows = [
      buildRow(5, { status: 'refunded', refundAt: refundedAt }),
      buildRow(6, { status: 'refunded', refundAt: null }),
    ];
    prismaService.clubVoucherOrder.findMany.mockResolvedValue(rows);

    const result = await service.listVoucherOrders(buildContext(), {
      status: 'refunded',
      limit: 1,
    });

    expect(result.hasMore).toBe(true);
    expect(
      decodeClubCursor(
        result.nextCursor ?? undefined,
        VOUCHER_ORDER_SORT_MAP.refunded.keys,
      ),
    ).toEqual({
      values: [refundedAt, new Date(1_761_100_000_000)],
      id: 5,
    });
  });

  it('游标与当前 Tab 的排序键不匹配时 400，且不查库', async () => {
    const usedCursor = encodeClubCursor(
      [null, null, new Date(1_761_100_000_000)],
      5,
    );

    await expect(
      service.listVoucherOrders(buildContext(), {
        status: 'all',
        cursor: usedCursor,
      }),
    ).rejects.toThrow('cursor 格式不合法');
    expect(prismaService.clubVoucherOrder.findMany).not.toHaveBeenCalled();
  });
});
