import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import { ClubCurrentStoreContextService } from '../stores/club-current-store-context.service';
import { ClubSelfOrderingOrderService } from './club-self-ordering-order.service';

/**
 * 自助下单建单测试：
 * - 价格由服务端按 Product 重算（不信任客户端），同商品多行先合并数量
 * - 幂等：缺失/过短拒绝、命中记录回放快照
 * - 会话：不存在或非 active 一律拒绝，杜绝订单挂到已结账会话
 */
describe('ClubSelfOrderingOrderService', () => {
  let service: ClubSelfOrderingOrderService;

  const prisma = {
    idempotencyRecord: {
      findUnique: jest.fn(),
    },
    spaceSession: { findFirst: jest.fn() },
    product: { findMany: jest.fn() },
    selfOrder: { findFirst: jest.fn(), findMany: jest.fn() },
    $transaction: jest.fn(),
  };

  /** 事务内客户端：service 的所有写操作都经由它 */
  const tx = {
    idempotencyRecord: { create: jest.fn(), update: jest.fn() },
    selfOrder: { create: jest.fn() },
  };

  const currentStoreContext = { requireCurrentContext: jest.fn() };
  const user = { id: 100 } as unknown as AuthenticatedUser;

  const createdOrder = {
    id: 1,
    orderNo: 'SF-test',
    storeId: 1,
    sessionId: 42,
    spaceId: 7,
    remark: null,
    itemTotalAmount: 1600,
    payableAmount: 1600,
    status: 'pending_payment',
    paymentStatus: 'unpaid',
    version: 0,
    createdAt: new Date('2026-09-04T00:00:00Z'),
    items: [
      {
        id: 1,
        productId: '101',
        productName: '可口可乐',
        categoryName: '酒水饮料',
        salePrice: 800,
        quantity: 2,
      },
    ],
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    currentStoreContext.requireCurrentContext.mockResolvedValue({
      store: { id: 1, businessMode: 'general' },
    });
    prisma.idempotencyRecord.findUnique.mockResolvedValue(null);
    prisma.spaceSession.findFirst.mockResolvedValue({ id: 42, spaceId: 7 });
    prisma.product.findMany.mockResolvedValue([
      {
        id: 101,
        name: '可口可乐',
        category: '酒水饮料',
        price: 800,
        costPrice: 300,
      },
    ]);
    tx.selfOrder.create.mockResolvedValue(createdOrder);
    tx.idempotencyRecord.create.mockResolvedValue({});
    tx.idempotencyRecord.update.mockResolvedValue({});
    prisma.$transaction.mockImplementation(
      (callback: (client: unknown) => Promise<unknown>) => callback(tx),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClubSelfOrderingOrderService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: ClubCurrentStoreContextService,
          useValue: currentStoreContext,
        },
      ],
    }).compile();
    service = module.get<ClubSelfOrderingOrderService>(
      ClubSelfOrderingOrderService,
    );
  });

  it('建单成功：服务端重算金额，应付恒等于商品合计', async () => {
    const result = await service.create(
      user,
      { sessionId: 42, items: [{ productId: '101', quantity: 2 }] },
      'idem-key-0001',
    );

    expect(tx.selfOrder.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          itemTotalAmount: 1600,
          payableAmount: 1600,
          status: 'pending_payment',
          paymentStatus: 'unpaid',
        }),
      }),
    );
    expect(result).toMatchObject({ payableAmount: 1600, sessionId: 42 });
  });

  it('同一商品多行时先合并数量', async () => {
    await service.create(
      user,
      {
        sessionId: 42,
        items: [
          { productId: '101', quantity: 1 },
          { productId: '101', quantity: 2 },
        ],
      },
      'idem-key-0002',
    );

    expect(tx.selfOrder.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ itemTotalAmount: 2400 }),
      }),
    );
  });

  it('幂等键缺失或过短时拒绝', async () => {
    await expect(
      service.create(
        user,
        { sessionId: 42, items: [{ productId: '101', quantity: 1 }] },
        undefined,
      ),
    ).rejects.toThrow(ConflictException);

    await expect(
      service.create(
        user,
        { sessionId: 42, items: [{ productId: '101', quantity: 1 }] },
        'short',
      ),
    ).rejects.toThrow('请提供有效的 Idempotency-Key 以创建订单');
  });

  it('命中幂等记录时回放快照，不重复建单', async () => {
    prisma.idempotencyRecord.findUnique.mockResolvedValue({
      status: 'succeeded',
      responseSnapshot: { id: 99, orderNo: 'SF-replayed' },
    });

    const result = await service.create(
      user,
      { sessionId: 42, items: [{ productId: '101', quantity: 1 }] },
      'idem-key-0003',
    );

    expect(result).toEqual({ id: 99, orderNo: 'SF-replayed' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('会话不存在或非 active 时拒绝建单', async () => {
    prisma.spaceSession.findFirst.mockResolvedValue(null);

    await expect(
      service.create(
        user,
        { sessionId: 42, items: [{ productId: '101', quantity: 1 }] },
        'idem-key-0004',
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('商品下架时拒绝建单', async () => {
    prisma.product.findMany.mockResolvedValue([]);

    await expect(
      service.create(
        user,
        { sessionId: 42, items: [{ productId: '101', quantity: 1 }] },
        'idem-key-0005',
      ),
    ).rejects.toThrow(NotFoundException);
  });
});
