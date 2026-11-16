import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { ClubCardContextService } from './club-card-context.service';
import { ClubCardQueryService } from './club-card-query.service';
import type { ClubCurrentContext } from '../stores/club-stores.types';
import {
  decodeClubCursor,
  encodeClubCursor,
} from '../shared/club-keyset-cursor.util';

/** 卡包列表游标键：与 service 内声明保持一致（单键 createdAt，不可空） */
const CARD_CURSOR_KEYS = [{ field: 'createdAt', nullable: false }];

const buildContext = (): ClubCurrentContext =>
  ({
    user: { id: 201, phone: '13800138000' },
    store: { id: 11, name: '望京店' },
  }) as unknown as ClubCurrentContext;

/** 卡视图所需最小字段（与 CARD_VIEW_SELECT 白名单一致） */
const buildCardRow = (
  id: number,
  createdAt: Date,
  storeId = 11,
): Record<string, unknown> => ({
  id,
  storeId,
  planId: 3,
  cardNo: `MC${id}`,
  kind: 'times',
  nameSnapshot: '10 次卡',
  status: 'active',
  startsAt: new Date(1_700_000_000_000),
  expiresAt: null,
  totalTimes: 10,
  remainTimes: 8,
  createdAt,
});

describe('ClubCardQueryService · 我的卡包游标分页', () => {
  let service: ClubCardQueryService;

  const prismaService = {
    $transaction: jest.fn(),
    memberCard: {
      count: jest.fn(),
      findMany: jest.fn(),
    },
  };
  const contextService = {
    assertStoreMatches: jest.fn(),
    resolveOwnCustomerIds: jest.fn(),
    resolveStoreNames: jest.fn(),
    listAvailablePlans: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClubCardQueryService,
        { provide: PrismaService, useValue: prismaService },
        { provide: ClubCardContextService, useValue: contextService },
      ],
    }).compile();

    service = module.get<ClubCardQueryService>(ClubCardQueryService);

    contextService.resolveOwnCustomerIds.mockResolvedValue([55]);
    contextService.resolveStoreNames.mockResolvedValue(
      new Map([[11, '望京店']]),
    );
  });

  it('两个只读查询并行发出，不再独占一个事务连接', async () => {
    prismaService.memberCard.findMany.mockResolvedValue([
      buildCardRow(1, new Date(1_761_100_000_000)),
    ]);
    prismaService.memberCard.count.mockResolvedValue(1);

    await service.listMyCards(buildContext());

    expect(prismaService.$transaction).not.toHaveBeenCalled();
  });

  it('首屏不带游标条件，默认隐藏已退款的卡', async () => {
    prismaService.memberCard.findMany.mockResolvedValue([
      buildCardRow(1, new Date(1_761_100_000_000)),
    ]);
    prismaService.memberCard.count.mockResolvedValue(1);

    await service.listMyCards(buildContext());

    const findManyArg = prismaService.memberCard.findMany.mock.calls[0][0];
    expect(findManyArg).toMatchObject({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      // 每页 20 条时多取一行判末页
      take: 21,
    });
    expect(findManyArg).not.toHaveProperty('skip');
    expect(findManyArg.where).toEqual({
      customerId: { in: [55] },
      AND: [{ status: { not: 'refunded' } }],
    });
  });

  it('total 是筛选后总数，count 与列表用同一个 where', async () => {
    prismaService.memberCard.findMany.mockResolvedValue([
      buildCardRow(1, new Date(1_761_100_000_000)),
    ]);
    prismaService.memberCard.count.mockResolvedValue(23);

    const result = await service.listMyCards(buildContext(), {
      status: 'active',
    });

    const findManyWhere =
      prismaService.memberCard.findMany.mock.calls[0][0].where;
    const countWhere = prismaService.memberCard.count.mock.calls[0][0].where;
    expect(countWhere).toEqual(findManyWhere);
    // 状态派生过滤与游标条件都在 AND 里，不互相覆盖
    expect(findManyWhere.AND[0]).toMatchObject({ status: 'active' });
    expect(result.total).toBe(23);
  });

  it('翻页用「createdAt 更小 / 同刻 id 更小」条件，不丢也不重', async () => {
    const createdAt = new Date(1_761_100_000_000);
    const cursorRow = buildCardRow(9, createdAt);
    const cursor = encodeClubCursor(
      [cursorRow.createdAt as Date],
      cursorRow.id as number,
    );
    prismaService.memberCard.findMany.mockResolvedValue([]);
    prismaService.memberCard.count.mockResolvedValue(10);

    await service.listMyCards(buildContext(), { cursor });

    const findManyArg = prismaService.memberCard.findMany.mock.calls[0][0];
    // Prisma DateTime 过滤只接受 Date，不能传毫秒数字
    expect(findManyArg.where.AND[1]).toEqual({
      OR: [{ createdAt: { lt: createdAt } }, { createdAt, id: { lt: 9 } }],
    });
    // 计数不带游标条件，避免 total 随翻页递减
    expect(
      prismaService.memberCard.count.mock.calls[0][0].where.AND,
    ).toHaveLength(1);
  });

  it('末页 nextCursor 为 null；有下一页时由本页最后一行编码', async () => {
    const rows = [
      buildCardRow(3, new Date(1_761_100_000_000)),
      buildCardRow(2, new Date(1_761_000_000_000)),
    ];

    // 只有一行且 limit=1：无更多
    prismaService.memberCard.findMany.mockResolvedValue([rows[0]]);
    prismaService.memberCard.count.mockResolvedValue(1);
    const lastPage = await service.listMyCards(buildContext(), { limit: 1 });
    expect(lastPage.nextCursor).toBeNull();

    // 多取到一行：还有下一页，游标取「本页最后一行」而不是多取行
    prismaService.memberCard.findMany.mockResolvedValue(rows);
    const firstPage = await service.listMyCards(buildContext(), { limit: 1 });
    expect(firstPage.items).toHaveLength(1);
    expect(
      decodeClubCursor(firstPage.nextCursor ?? undefined, CARD_CURSOR_KEYS),
    ).toEqual({
      values: [rows[0].createdAt as Date],
      id: rows[0].id as number,
    });
  });

  it('游标非法时 400，且不发起查询', async () => {
    await expect(
      service.listMyCards(buildContext(), { cursor: '20' }),
    ).rejects.toThrow('cursor 格式不合法');
    expect(prismaService.memberCard.findMany).not.toHaveBeenCalled();
  });

  it('本人没有任何顾客档案时返回空页，不查库', async () => {
    contextService.resolveOwnCustomerIds.mockResolvedValue([]);

    await expect(service.listMyCards(buildContext())).resolves.toEqual({
      items: [],
      nextCursor: null,
      total: 0,
    });
    expect(prismaService.memberCard.findMany).not.toHaveBeenCalled();
  });
});
