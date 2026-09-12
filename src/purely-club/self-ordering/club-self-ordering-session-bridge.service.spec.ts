import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { ClubSelfOrderingSessionBridgeService } from './club-self-ordering-session-bridge.service';

/**
 * 空间账单桥接测试：
 * - 首次录入：追加到账单末尾（sortOrder = 当前最大 +1），单件利润 = 售价 - 成本，累加 itemsCost
 * - 重复录入：同一 sourceOrderNo 直接短路 —— 这是支付回调重复触发时防重复累加的关键
 */
describe('ClubSelfOrderingSessionBridgeService', () => {
  let service: ClubSelfOrderingSessionBridgeService;

  /** 事务内客户端 mock */
  const tx = {
    spaceSessionItem: {
      findFirst: jest.fn(),
      aggregate: jest.fn(),
      createMany: jest.fn(),
    },
    spaceSession: { update: jest.fn(), findUnique: jest.fn() },
    product: { findFirst: jest.fn(), update: jest.fn() },
    inventoryAdjustmentLog: { create: jest.fn() },
  };

  const items = [
    {
      id: 11,
      productId: '101',
      productName: '可口可乐',
      categoryName: '酒水饮料',
      salePrice: 800,
      costPrice: 300,
      quantity: 2,
    },
    {
      id: 12,
      productId: '201',
      productName: '乐事薯片',
      categoryName: '零食小吃',
      salePrice: 1000,
      costPrice: 600,
      quantity: 1,
    },
  ];

  const append = (): Promise<void> =>
    service.appendPaidItemsToSession(tx as never, {
      sessionId: 42,
      orderNo: 'SF-1',
      sourceChannel: 'balance',
      items,
    });

  beforeEach(async () => {
    jest.clearAllMocks();
    tx.spaceSessionItem.findFirst.mockResolvedValue(null);
    tx.spaceSessionItem.aggregate.mockResolvedValue({ _max: { sortOrder: 4 } });
    tx.spaceSessionItem.createMany.mockResolvedValue({ count: 2 });
    tx.spaceSession.update.mockResolvedValue({});
    tx.spaceSession.findUnique.mockResolvedValue({ storeId: 7 });
    // 可乐库存 10、薯片库存 1（后者用于覆盖库存不足场景）
    tx.product.findFirst.mockImplementation(
      ({ where }: { where: { id: number } }) =>
        Promise.resolve(
          where.id === 101
            ? { id: 101, name: '可口可乐', stock: 10 }
            : { id: 201, name: '乐事薯片', stock: 1 },
        ),
    );
    tx.product.update.mockResolvedValue({});
    tx.inventoryAdjustmentLog.create.mockResolvedValue({});

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClubSelfOrderingSessionBridgeService,
        { provide: PrismaService, useValue: {} },
      ],
    }).compile();
    service = module.get<ClubSelfOrderingSessionBridgeService>(
      ClubSelfOrderingSessionBridgeService,
    );
  });

  it('首次录入：追加到账单末尾并标记来源', async () => {
    await append();

    expect(tx.spaceSessionItem.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          sessionId: 42,
          productId: '101',
          productName: '可口可乐',
          categoryName: '酒水饮料',
          salePrice: 800,
          profit: 500,
          quantity: 2,
          sortOrder: 5,
          sourceType: 'member_self_order',
          sourceChannel: 'balance',
          sourceOrderNo: 'SF-1',
          sourceOrderItemId: 11,
        }),
        expect.objectContaining({
          productId: '201',
          profit: 400,
          sortOrder: 6,
          sourceOrderItemId: 12,
        }),
      ],
    });
  });

  it('规格行写入 specSignature / specNames，无规格行保持 null', async () => {
    await service.appendPaidItemsToSession(tx as never, {
      sessionId: 42,
      orderNo: 'SF-2',
      sourceChannel: 'wechat',
      items: [
        {
          id: 21,
          productId: '101',
          productName: '可口可乐（大杯）',
          categoryName: '酒水饮料',
          salePrice: 1000,
          costPrice: 300,
          quantity: 1,
          specSignature: 'sig-11',
          specNames: ['大杯'],
        },
        {
          id: 22,
          productId: '201',
          productName: '乐事薯片',
          categoryName: '零食小吃',
          salePrice: 1000,
          costPrice: 600,
          quantity: 1,
        },
      ],
    });

    const { data } = tx.spaceSessionItem.createMany.mock.calls[0][0] as {
      data: Array<Record<string, unknown>>;
    };
    // 规格加价等额计入利润：1000 - 300 = 700
    expect(data[0]).toEqual(
      expect.objectContaining({
        specSignature: 'sig-11',
        specNames: ['大杯'],
        profit: 700,
      }),
    );
    expect(data[1]).toEqual(expect.objectContaining({ specSignature: null }));
    expect(data[1].specNames).toBeUndefined();
  });

  it('首次录入：按售价 × 数量累加会话 itemsCost', async () => {
    await append();

    // 800×2 + 1000×1 = 2600
    expect(tx.spaceSession.update).toHaveBeenCalledWith({
      where: { id: 42 },
      data: { itemsCost: { increment: 2600 } },
    });
  });

  it('首次录入：按数量扣减商品库存（自助下单也是真实销售）', async () => {
    await append();

    // 可乐 2 件、薯片 1 件
    expect(tx.product.update).toHaveBeenCalledWith({
      where: { id: 101 },
      data: { stock: { increment: -2 } },
    });
    expect(tx.product.update).toHaveBeenCalledWith({
      where: { id: 201 },
      data: { stock: { increment: -1 } },
    });
    expect(tx.inventoryAdjustmentLog.create).toHaveBeenCalledTimes(2);
    expect(tx.inventoryAdjustmentLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          storeId: 7,
          productId: 101,
          beforeStock: 10,
          afterStock: 8,
          delta: -2,
          adjustType: 'sale',
          note: '会员自助下单',
        }),
      }),
    );
  });

  it('库存不足时扣至 0 且不阻断入账（支付已发生，不能回滚落账）', async () => {
    tx.product.findFirst.mockImplementation(
      ({ where }: { where: { id: number } }) =>
        Promise.resolve(
          where.id === 101
            ? { id: 101, name: '可口可乐', stock: 1 }
            : { id: 201, name: '乐事薯片', stock: 0 },
        ),
    );

    await expect(append()).resolves.toBeUndefined();

    // 可乐：需要 2 只有 1，扣至 0
    expect(tx.product.update).toHaveBeenCalledWith({
      where: { id: 101 },
      data: { stock: { increment: -1 } },
    });
    expect(tx.inventoryAdjustmentLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          productId: 101,
          delta: -1,
          afterStock: 0,
          note: expect.stringContaining('库存不足'),
        }),
      }),
    );
    // 薯片库存已为 0：无可扣量，不产生流水噪音
    expect(tx.product.update).not.toHaveBeenCalledWith({
      where: { id: 201 },
      data: expect.anything(),
    });
  });

  it('商品不存在时跳过扣减，不影响账单入账', async () => {
    tx.product.findFirst.mockResolvedValue(null);

    await expect(append()).resolves.toBeUndefined();

    expect(tx.product.update).not.toHaveBeenCalled();
    expect(tx.spaceSessionItem.createMany).toHaveBeenCalled();
  });

  it('重复录入时幂等短路，不重复写入也不重复累加金额', async () => {
    tx.spaceSessionItem.findFirst.mockResolvedValue({ id: 999 });

    await append();

    expect(tx.spaceSessionItem.createMany).not.toHaveBeenCalled();
    expect(tx.spaceSession.update).not.toHaveBeenCalled();
    // 幂等短路发生在扣减之前，不会重复扣库存
    expect(tx.product.update).not.toHaveBeenCalled();
  });

  it('订单无商品行时直接返回', async () => {
    await service.appendPaidItemsToSession(tx as never, {
      sessionId: 42,
      orderNo: 'SF-empty',
      sourceChannel: 'wechat',
      items: [],
    });

    expect(tx.spaceSessionItem.findFirst).not.toHaveBeenCalled();
    expect(tx.spaceSessionItem.createMany).not.toHaveBeenCalled();
  });
});
