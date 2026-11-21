/** 空间小票打印数据：查询字段瘦身与抵扣聚合等价性回归。 */
import { SpacePrintDataService } from './space-print-data.service';
import { sumNetPayableCents } from '../../commerce/commerce.utils';

type PrintItemRow = {
  productId: string;
  productName: string;
  salePrice: number;
  quantity: number;
  specNames: string[] | null;
  sourceType: string | null;
  sourceChannel: string | null;
};

const buildItem = (overrides: Partial<PrintItemRow> = {}): PrintItemRow => ({
  productId: 'P1',
  productName: '橙汁',
  salePrice: 1500,
  quantity: 1,
  specNames: null,
  sourceType: null,
  sourceChannel: null,
  ...overrides,
});

const sessionItems: PrintItemRow[] = [
  buildItem({
    productId: 'SYS_TIME_BILLING',
    productName: '台位费（固定）',
    salePrice: 8000,
  }),
  buildItem({
    productName: '橙汁（大杯/热）',
    salePrice: 1500,
    quantity: 2,
    specNames: ['大杯', '热'],
    sourceType: 'member_self_order',
    sourceChannel: 'wechat',
  }),
  buildItem({
    productId: 'SYS_RENEW_DEDUCTION',
    productName: '续费抵扣',
    salePrice: 3000,
  }),
  buildItem({
    productId: 'SYS_RENEW_DEDUCTION',
    productName: '续费抵扣',
    salePrice: 1000,
    quantity: 2,
  }),
  buildItem({
    productId: 'SYS_PREPAID_DEDUCTION',
    productName: '预付款',
    salePrice: 2000,
  }),
  buildItem({
    productId: 'SYS_SELF_ORDER_DEDUCTION',
    productName: '自助下单抵扣',
    salePrice: 1500,
    quantity: 2,
  }),
  buildItem({
    productId: 'SYS_GROUPON_VOUCHER',
    productName: '分手大师（团购券）',
    salePrice: 18870,
  }),
  buildItem({
    productId: 'SYS_GROUPON_VOUCHER',
    productName: '分手大师（团购券）',
    salePrice: 1000,
  }),
];

const startTime = new Date('2026-11-10T10:00:00+08:00');
const endTime = new Date('2026-11-10T12:00:00+08:00');

const saleOrder = {
  orderNo: 'SO20261110001',
  storeId: 11,
  store: { name: '测试门店' },
  refund: null,
  createdAt: endTime,
  paymentMethod: 'wechat',
  note: null,
  operatorNameSnapshot: '店长',
  spaceSession: {
    status: 'settled',
    storeId: 11,
    endTime,
    guestName: '张三',
    guestCount: 2,
    startTime,
    billingMode: 'countdown',
    hourlyRate: 8000,
    timeCost: 8000,
    itemsCost: 5000,
    space: { name: 'A02（小包）', type: { name: '包间' } },
    sessionItems,
  },
};

describe('SpacePrintDataService.loadOrder', () => {
  const prismaService = { saleOrder: { findFirst: jest.fn() } };
  let service: SpacePrintDataService;

  beforeEach(() => {
    jest.clearAllMocks();
    prismaService.saleOrder.findFirst.mockResolvedValue(saleOrder);
    service = new SpacePrintDataService(prismaService as never);
  });

  it('按实际消费字段查询，四类抵扣单次累加结果与分列聚合一致', async () => {
    const order = await service.loadOrder(11, 1);

    expect(prismaService.saleOrder.findFirst).toHaveBeenCalledWith({
      where: { id: 1, storeId: 11 },
      include: {
        store: { select: { name: true } },
        refund: { select: { refundedAt: true } },
        spaceSession: {
          include: {
            space: {
              select: {
                name: true,
                type: { select: { name: true } },
              },
            },
            sessionItems: {
              select: {
                productId: true,
                productName: true,
                salePrice: true,
                quantity: true,
                specNames: true,
                sourceType: true,
                sourceChannel: true,
              },
              orderBy: { sortOrder: 'asc' },
            },
          },
        },
      },
    });

    expect(order.spaceName).toBe('A02（小包）');
    expect(order.spaceType).toBe('包间');
    expect(order.timeFeeLabel).toBe('固定');
    expect(order.renewDeduction).toBe(50);
    expect(order.prepaidDeduction).toBe(20);
    expect(order.selfOrderDeduction).toBe(30);
    expect(order.voucherConsumption).toBeCloseTo(198.7);
    expect(order.items).toEqual([
      {
        name: '橙汁',
        quantity: 2,
        unitPrice: 15,
        subtotal: 30,
        sourceType: 'member_self_order',
        sourceChannel: 'wechat',
        specNames: ['大杯', '热'],
      },
    ]);
    // 应付合计仍走 sumNetPayableCents 口径，裁剪字段后不得改变取值
    expect(order.totalAmount).toBeCloseTo(
      sumNetPayableCents(sessionItems) / 100,
    );
  });

  it('真实商品名恰好叫「预付款」时按普通商品计入，不被当作抵扣', async () => {
    // 商家自建商品可能叫「预付款」：它是真实商品（数字 productId），
    // 明细会打印它，抵扣与合计就不能再按名称把它扣一次，否则票面自相矛盾。
    const realProductItems = [
      buildItem({
        productId: '501',
        productName: '预付款',
        salePrice: 5000,
      }),
    ];
    prismaService.saleOrder.findFirst.mockResolvedValue({
      ...saleOrder,
      spaceSession: {
        ...saleOrder.spaceSession,
        sessionItems: realProductItems,
        itemsCost: 5000,
      },
    });

    const order = await service.loadOrder(11, 1);

    expect(order.prepaidDeduction).toBe(0);
    expect(order.items).toEqual([
      {
        name: '预付款',
        quantity: 1,
        unitPrice: 50,
        subtotal: 50,
        sourceType: null,
        sourceChannel: null,
      },
    ]);
    // 明细 ¥50 与合计必须一致（修复前会被当成抵扣算出 -¥50）
    expect(order.totalAmount).toBeCloseTo(50);
  });

  it('历史抵扣行（非数字 ID）按名称进分栏，明细与合计不再互相矛盾', async () => {
    // 早期系统行的 productId 不是 SYS_*，只能按名称识别：它必须同时
    // 从商品明细剔除、计入抵扣分栏、冲减合计，三处不能各判各的。
    const legacyItems = [
      buildItem({ productId: '501', productName: '果盘', salePrice: 5000 }),
      buildItem({
        productId: 'legacy-prepay-1',
        productName: '预付款',
        salePrice: 2000,
      }),
    ];
    prismaService.saleOrder.findFirst.mockResolvedValue({
      ...saleOrder,
      spaceSession: {
        ...saleOrder.spaceSession,
        sessionItems: legacyItems,
        itemsCost: 5000,
      },
    });

    const order = await service.loadOrder(11, 1);

    expect(order.prepaidDeduction).toBe(20);
    expect(order.items).toEqual([
      {
        name: '果盘',
        quantity: 1,
        unitPrice: 50,
        subtotal: 50,
        sourceType: null,
        sourceChannel: null,
      },
    ]);
    // 修复前：明细加总 ¥70、抵扣显示 ¥0、合计却是 ¥30
    expect(order.totalAmount).toBeCloseTo(30);
  });

  it('历史抵扣行落负数时，分栏与合计都按绝对额显示', async () => {
    // 历史手工单可能把抵扣行存成负数（-20 元）。分栏若直接累加会得到 -20，
    // 而模板只渲染大于 0 的抵扣 → 票面上看不见这笔扣款，合计却已经少了 20。
    const negativeItems = [
      buildItem({ productId: '501', productName: '果盘', salePrice: 5000 }),
      buildItem({
        productId: 'legacy-prepay-2',
        productName: '预付款',
        salePrice: -2000,
      }),
    ];
    prismaService.saleOrder.findFirst.mockResolvedValue({
      ...saleOrder,
      spaceSession: {
        ...saleOrder.spaceSession,
        sessionItems: negativeItems,
        itemsCost: 5000,
      },
    });

    const order = await service.loadOrder(11, 1);

    // 分栏必须是正数（否则票面隐藏），且与合计扣减的金额一致
    expect(order.prepaidDeduction).toBe(20);
    expect(order.totalAmount).toBeCloseTo(30);
  });

  it('无系统行时四项抵扣均为 0，商品明细保持原输出', async () => {
    const plainItems = [
      buildItem({
        productId: 'P2',
        productName: '可乐',
        salePrice: 800,
        quantity: 2,
      }),
    ];
    prismaService.saleOrder.findFirst.mockResolvedValue({
      ...saleOrder,
      spaceSession: { ...saleOrder.spaceSession, sessionItems: plainItems },
    });

    const order = await service.loadOrder(11, 1);

    expect(order.renewDeduction).toBe(0);
    expect(order.prepaidDeduction).toBe(0);
    expect(order.selfOrderDeduction).toBe(0);
    expect(order.voucherConsumption).toBe(0);
    expect(order.timeFeeLabel).toBe('');
    expect(order.items).toEqual([
      {
        name: '可乐',
        quantity: 2,
        unitPrice: 8,
        subtotal: 16,
        sourceType: null,
        sourceChannel: null,
      },
    ]);
  });
});

describe('SpacePrintDataService.listRecentSettledOrders', () => {
  const prismaService = { spaceSession: { findMany: jest.fn() } };
  let service: SpacePrintDataService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SpacePrintDataService(prismaService as never);
  });

  it('按已结账会话倒序查询，丢弃空订单号/空结账时间并归一为 ISO 字符串', async () => {
    prismaService.spaceSession.findMany.mockResolvedValue([
      {
        saleOrderId: 1292,
        endTime: new Date('2026-11-20T07:08:08.164Z'),
        space: { name: 'A02（小包）' },
      },
      {
        // 历史脏数据：已结账但订单号缺失，不能进补打入口
        saleOrderId: null,
        endTime: new Date('2026-11-20T07:00:00.000Z'),
        space: { name: 'A04' },
      },
      {
        saleOrderId: 1290,
        endTime: null,
        space: { name: 'A04' },
      },
    ]);

    const list = await service.listRecentSettledOrders(42, 5);

    expect(prismaService.spaceSession.findMany).toHaveBeenCalledWith({
      where: { storeId: 42, status: 'settled', saleOrderId: { not: null } },
      orderBy: [{ endTime: 'desc' }, { id: 'desc' }],
      take: 5,
      select: {
        saleOrderId: true,
        endTime: true,
        space: { select: { name: true } },
      },
    });
    expect(list).toEqual([
      {
        saleOrderId: 1292,
        spaceName: 'A02（小包）',
        settledAt: '2026-11-20T07:08:08.164Z',
      },
    ]);
  });
});

describe('SpacePrintDataService.loadSalesReceiptOrder', () => {
  const prismaService = { saleOrder: { findFirst: jest.fn() } };
  let service: SpacePrintDataService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SpacePrintDataService(prismaService as never);
  });

  it('已结账未退款的空间单可补打，票面时间/操作员来自落库数据', async () => {
    prismaService.saleOrder.findFirst.mockResolvedValue(saleOrder);

    const order = await service.loadSalesReceiptOrder(11, 1);

    expect(prismaService.saleOrder.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 1, storeId: 11 } }),
    );
    expect(order.storeName).toBe('测试门店');
    expect(order.startedAt).toBe(startTime.getTime());
    expect(order.settledAt).toBe(endTime.getTime());
    expect(order.paymentMethod).toBe('wechat');
  });

  it('跨店 / 不存在：按不存在处理，不泄露订单归属', async () => {
    prismaService.saleOrder.findFirst.mockResolvedValue(null);

    await expect(service.loadSalesReceiptOrder(11, 999)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('无空间会话关联（手工录单/扫码点餐单）拒绝补打', async () => {
    prismaService.saleOrder.findFirst.mockResolvedValue({
      ...saleOrder,
      spaceSession: null,
    });

    await expect(service.loadSalesReceiptOrder(11, 1)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('会话未结账拒绝补打', async () => {
    prismaService.saleOrder.findFirst.mockResolvedValue({
      ...saleOrder,
      spaceSession: { ...saleOrder.spaceSession, status: 'active' },
    });

    await expect(service.loadSalesReceiptOrder(11, 1)).rejects.toMatchObject({
      status: 400,
    });
  });

  it('订单已退款拒绝补打', async () => {
    prismaService.saleOrder.findFirst.mockResolvedValue({
      ...saleOrder,
      refund: { refundedAt: endTime },
    });

    await expect(service.loadSalesReceiptOrder(11, 1)).rejects.toMatchObject({
      status: 400,
    });
  });
});
