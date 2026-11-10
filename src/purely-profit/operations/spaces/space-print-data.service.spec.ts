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
  createdAt: endTime,
  paymentMethod: 'wechat',
  note: null,
  operatorNameSnapshot: '店长',
  spaceSession: {
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
