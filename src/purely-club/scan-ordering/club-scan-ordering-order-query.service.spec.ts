import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import {
  buildSessionVisibilityWhere,
  ClubScanOrderingOrderQueryService,
} from './club-scan-ordering-order-query.service';
import { ScanOrderingPickupNumberService } from './scan-ordering-pickup-number.service';

describe('ClubScanOrderingOrderQueryService', () => {
  let service: ClubScanOrderingOrderQueryService;

  const prisma = {
    scanOrderingSession: { findMany: jest.fn() },
    scanOrderingMenuProduct: { findMany: jest.fn() },
  };
  const user = { id: 7 } as AuthenticatedUser;

  /** 取最后一次会话查询的 where（第一次是 activeDiningRoundIds 的轮次查询） */
  const sessionQueryWhere = (): Record<string, unknown> =>
    prisma.scanOrderingSession.findMany.mock.calls.at(-1)![0].where;

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma.scanOrderingSession.findMany.mockResolvedValue([]);
    prisma.scanOrderingMenuProduct.findMany.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClubScanOrderingOrderQueryService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: ScanOrderingPickupNumberService,
          useValue: { formatPickupNumber: jest.fn(() => null) },
        },
      ],
    }).compile();
    service = module.get(ClubScanOrderingOrderQueryService);
  });

  it('active 会话过期但仍有在途订单时必须命中（与 getCurrentSession 同口径）', async () => {
    await service.listOrders(user, {} as never);

    const where = sessionQueryWhere();
    const activeBranch = (where.OR as Record<string, unknown>[])[0];

    expect(activeBranch.status).toBe('active');
    // 会话 TTL（4h）只限制 C 端继续点餐，不该让在途订单从订单追踪页消失：
    // getCurrentSession 与商家端桌台查询都认可「已过期 + 有在途订单」的 active 会话，
    // 只有本查询的 active 分支要求 expiresAt > now，超过 TTL 后订单在顾客端会凭空消失。
    expect(activeBranch.OR).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          orders: expect.objectContaining({
            some: expect.objectContaining({
              status: expect.objectContaining({
                in: expect.arrayContaining([
                  'pending_acceptance',
                  'preparing',
                  'served',
                ]),
              }),
            }),
          }),
        }),
      ]),
    );
  });

  it('追踪页只剩 2 次 DB 往返：菜单商品图片已并入主查询，不再单独回源', async () => {
    await service.listOrders(user, {} as never);

    // 第 1 次：当前有效轮次的 diningRoundId；第 2 次：主查询（含 items.menuProduct）
    expect(prisma.scanOrderingSession.findMany).toHaveBeenCalledTimes(2);
    expect(prisma.scanOrderingMenuProduct.findMany).not.toHaveBeenCalled();

    const select = prisma.scanOrderingSession.findMany.mock.calls.at(-1)![0]
      .select as Record<string, unknown>;
    const orders = select.orders as { select: Record<string, unknown> };
    const items = orders.select.items as { select: Record<string, unknown> };
    expect(items.select.menuProduct).toEqual({
      select: { imageUrl: true, product: { select: { image: true } } },
    });
  });
});

describe('buildSessionVisibilityWhere（3 个 OR 分支各自命中 / 不命中）', () => {
  const now = new Date('2026-06-12T12:00:00.000Z');
  const roundIds = ['round-current'];

  const branches = (where: unknown): Record<string, unknown>[] =>
    (where as { OR: Record<string, unknown>[] }).OR;

  it('分支 1 只看「active + 未过期或有在途订单」，与轮次集合无关', () => {
    const [withoutRounds, withRounds] = [
      branches(
        buildSessionVisibilityWhere({ now, activeDiningRoundIds: [] }),
      )[0]!,
      branches(
        buildSessionVisibilityWhere({ now, activeDiningRoundIds: roundIds }),
      )[0]!,
    ];

    expect(withoutRounds).toEqual(withRounds);
    expect(withoutRounds.status).toBe('active');
    expect(withoutRounds.deletedAt).toBeNull();
  });

  it('分支 2 命中条件：left + 4h 窗口内 + 轮次属于当前有效轮次', () => {
    const branch = branches(
      buildSessionVisibilityWhere({ now, activeDiningRoundIds: roundIds }),
    )[1]!;

    expect(branch.status).toBe('left');
    expect(branch.diningRoundId).toEqual({ in: ['round-current'] });
    expect(branch.lastActiveAt).toEqual({
      gte: new Date(now.getTime() - 4 * 60 * 60 * 1000),
    });
  });

  it('分支 2 不命中：没有当前有效轮次时集合为空（不会退化成「全部 left 会话」）', () => {
    const branch = branches(
      buildSessionVisibilityWhere({ now, activeDiningRoundIds: [] }),
    )[1]!;

    expect(branch.diningRoundId).toEqual({ in: [] });
  });

  it('分支 3 与轮次集合无关：只要 left 会话说还有未闭环订单就命中', () => {
    const withRounds = branches(
      buildSessionVisibilityWhere({ now, activeDiningRoundIds: roundIds }),
    )[2]!;
    const withoutRounds = branches(
      buildSessionVisibilityWhere({ now, activeDiningRoundIds: [] }),
    )[2]!;

    expect(withoutRounds).toEqual(withRounds);
    expect(withRounds.status).toBe('left');
    expect(withRounds.orders).toEqual({
      some: {
        deletedAt: null,
        status: {
          in: ['pending_payment', 'pending_acceptance', 'preparing', 'served'],
        },
      },
    });
  });

  it('分支 2 与分支 3 不重叠：分支 2 不要求有在途订单，分支 3 不看活跃窗口', () => {
    const [first, second, third] = branches(
      buildSessionVisibilityWhere({ now, activeDiningRoundIds: roundIds }),
    );

    expect(first).not.toHaveProperty('lastActiveAt');
    expect(second).toHaveProperty('lastActiveAt');
    expect(second).not.toHaveProperty('orders');
    expect(third).not.toHaveProperty('lastActiveAt');
    expect(third).not.toHaveProperty('diningRoundId');
  });
});
