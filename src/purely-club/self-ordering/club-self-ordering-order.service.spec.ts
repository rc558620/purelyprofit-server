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
import { ProductSpecPricingService } from '../../purely-profit/goods/products/product-spec-pricing.service';

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

  /** 建单写入的订单行结构（只声明断言用到的字段） */
  interface CreatedItem {
    productName: string;
    salePrice: number;
    costPrice: number;
    quantity: number;
    specSignature: string | null;
    specs?: {
      create: Array<{
        specOptionId: number;
        specOptionNameSnapshot: string;
        extraPriceSnapshot: number;
      }>;
    };
  }

  /** 取最近一次建单写入的订单行 */
  const lastCreatedItems = (): CreatedItem[] => {
    const calls = tx.selfOrder.create.mock.calls as unknown as Array<
      [{ data: { items: { create: CreatedItem[] } } }]
    >;
    return calls[calls.length - 1][0].data.items.create;
  };

  /**
   * 商品规格定价桩：商品 101 = 可口可乐（800 分 / 成本 300 分），
   * 选中选项 11（大杯 +200 分）后单价 1000 分、展示名带规格后缀。
   */
  const specPricing = {
    price: jest.fn(
      (input: {
        storeId: number;
        productId: number;
        specOptionIds?: number[] | null;
      }): Promise<Record<string, unknown>> => {
        if (input.productId !== 101) {
          return Promise.reject(new NotFoundException('商品不存在或已下架'));
        }
        const ids = [...new Set(input.specOptionIds ?? [])].sort(
          (left, right) => left - right,
        );
        const hasSpec = ids.length > 0;
        return Promise.resolve({
          menuProductId: hasSpec ? 77 : null,
          unitPriceCents: hasSpec ? 1000 : 800,
          costPriceCents: 300,
          profitCents: hasSpec ? 700 : 500,
          categoryName: '酒水饮料',
          specOptionIds: ids,
          specNames: hasSpec ? ['大杯'] : [],
          specOptions: hasSpec
            ? [{ id: 11, name: '大杯', extraPrice: 200 }]
            : [],
          specSignature: hasSpec ? `sig-${ids.join('-')}` : null,
          displayName: hasSpec ? '可口可乐（大杯）' : '可口可乐',
        });
      },
    ),
  };

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
        { provide: ProductSpecPricingService, useValue: specPricing },
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
    specPricing.price.mockRejectedValueOnce(
      new NotFoundException('商品不存在或已下架'),
    );

    await expect(
      service.create(
        user,
        { sessionId: 42, items: [{ productId: '101', quantity: 1 }] },
        'idem-key-0005',
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('同商品不同规格生成两行，相同规格合并数量', async () => {
    await service.create(
      user,
      {
        sessionId: 42,
        items: [
          { productId: '101', quantity: 1, specOptionIds: [11] },
          { productId: '101', quantity: 2 },
          { productId: '101', quantity: 3 },
        ],
      },
      'idem-key-0006',
    );

    const created = lastCreatedItems();
    expect(created).toHaveLength(2);
    expect(created.map((item) => item.quantity)).toEqual([1, 5]);
    expect(created.map((item) => item.specSignature)).toEqual(['sig-11', null]);
  });

  it('规格行落库展示名、权威单价与规格明细快照', async () => {
    await service.create(
      user,
      {
        sessionId: 42,
        items: [{ productId: '101', quantity: 2, specOptionIds: [11] }],
      },
      'idem-key-0007',
    );

    const [item] = lastCreatedItems();
    expect(item).toEqual(
      expect.objectContaining({
        productName: '可口可乐（大杯）',
        salePrice: 1000,
        costPrice: 300,
      }),
    );
    expect(item.specs?.create).toEqual([
      {
        specOptionId: 11,
        specOptionNameSnapshot: '大杯',
        extraPriceSnapshot: 200,
      },
    ]);
  });

  it('幂等指纹纳入规格签名：同商品不同规格指纹不同', async () => {
    const hashOf = async (specOptionIds?: number[]): Promise<unknown> => {
      await service.create(
        user,
        {
          sessionId: 42,
          items: [{ productId: '101', quantity: 1, specOptionIds }],
        },
        'idem-key-0008',
      );
      return tx.idempotencyRecord.create.mock.calls[
        tx.idempotencyRecord.create.mock.calls.length - 1
      ][0].data.requestHash;
    };

    const plainHash = await hashOf();
    const specHash = await hashOf([11]);

    expect(plainHash).not.toBe(specHash);
  });
});
