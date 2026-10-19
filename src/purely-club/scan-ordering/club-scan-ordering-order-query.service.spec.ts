import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { ClubScanOrderingOrderQueryService } from './club-scan-ordering-order-query.service';
import { ScanOrderingPickupNumberService } from './scan-ordering-pickup-number.service';

describe('ClubScanOrderingOrderQueryService', () => {
  let service: ClubScanOrderingOrderQueryService;

  const prisma = {
    scanOrderingSession: { findMany: jest.fn() },
    scanOrderingMenuProduct: { findMany: jest.fn() },
  };
  const user = { id: 7 } as AuthenticatedUser;

  /** 取最后一次会话查询的 where（第一次是 activeDiningRoundIds 的轮次查询） */
  const sessionQueryWhere = (): Record<string, any> =>
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
    const activeBranch = (where.OR as any[])[0];

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
                in: expect.arrayContaining(['pending_acceptance', 'preparing', 'served']),
              }),
            }),
          }),
        }),
      ]),
    );
  });
});
