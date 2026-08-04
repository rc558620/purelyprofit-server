import { Test, TestingModule } from '@nestjs/testing';
import { SalesRecordService } from '../../purely-profit/operations/sales-record/sales-record.service';
import { ScanOrderingSaleOrderBridgeService } from './scan-ordering-sale-order-bridge.service';

describe('ScanOrderingSaleOrderBridgeService', () => {
  let service: ScanOrderingSaleOrderBridgeService;

  const transactionClient = {
    saleOrder: {
      findUnique: jest.fn(),
    },
    scanOrders: {
      findUniqueOrThrow: jest.fn(),
    },
  };

  const salesRecordService = {
    create: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    salesRecordService.create.mockResolvedValue({ id: 1 });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScanOrderingSaleOrderBridgeService,
        { provide: SalesRecordService, useValue: salesRecordService },
      ],
    }).compile();

    service = module.get<ScanOrderingSaleOrderBridgeService>(
      ScanOrderingSaleOrderBridgeService,
    );
  });

  const buildOrder = (
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> => ({
    id: 1001,
    storeId: 11,
    orderNo: 'SO20260803001',
    remark: null,
    paidAt: new Date('2026-08-03T10:00:00.000Z'),
    payableAmount: 2250,
    items: [
      {
        productNameSnapshot: '红烧肉',
        categoryNameSnapshot: '热菜',
        quantity: 2,
        payableLineAmount: 1200,
        menuProduct: { productId: 901 },
      },
      {
        productNameSnapshot: '米饭',
        categoryNameSnapshot: '主食',
        quantity: 1,
        payableLineAmount: 1050,
        menuProduct: { productId: 902 },
      },
    ],
    ...overrides,
  });

  describe('幂等', () => {
    it('已存在同 scanOrderId 的 SaleOrder 时直接返回，不重复创建', async () => {
      transactionClient.saleOrder.findUnique.mockResolvedValue({ id: 99 });

      await service.createForPaidOrder(transactionClient, 1001, 'wechat');

      expect(transactionClient.saleOrder.findUnique).toHaveBeenCalledWith({
        where: { scanOrderId: 1001 },
        select: { id: true },
      });
      expect(
        transactionClient.scanOrders.findUniqueOrThrow,
      ).not.toHaveBeenCalled();
      expect(salesRecordService.create).not.toHaveBeenCalled();
    });

    it('不存在时才会加载订单并创建标准销售单', async () => {
      transactionClient.saleOrder.findUnique.mockResolvedValue(null);
      transactionClient.scanOrders.findUniqueOrThrow.mockResolvedValue(
        buildOrder(),
      );

      await service.createForPaidOrder(transactionClient, 1001, 'wechat');

      expect(salesRecordService.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('逐分合计分配', () => {
    it('明细按数量展开后，salePrice 总和精确等于 payableAmount（分）', async () => {
      transactionClient.saleOrder.findUnique.mockResolvedValue(null);
      transactionClient.scanOrders.findUniqueOrThrow.mockResolvedValue(
        buildOrder(),
      );

      await service.createForPaidOrder(transactionClient, 1001, 'wechat');

      const [, dto] = salesRecordService.create.mock.calls[0];
      const totalFen = (dto.items as Array<{ salePrice: number }>).reduce(
        (sum, item) => sum + Math.round(item.salePrice * 100),
        0,
      );
      expect(totalFen).toBe(2250);
    });

    it('每个展开明细 quantity = 1，salePrice 为元单位金额', async () => {
      transactionClient.saleOrder.findUnique.mockResolvedValue(null);
      transactionClient.scanOrders.findUniqueOrThrow.mockResolvedValue(
        buildOrder(),
      );

      await service.createForPaidOrder(transactionClient, 1001, 'wechat');

      const [, dto] = salesRecordService.create.mock.calls[0];
      expect(dto.items).toHaveLength(3); // 2 份红烧肉 + 1 份米饭
      for (const item of dto.items) {
        expect(item.quantity).toBe(1);
        expect(typeof item.salePrice).toBe('number');
      }
    });

    it('整单优惠（payableAmount < 原价合计）后明细总和仍等于最终应付', async () => {
      transactionClient.saleOrder.findUnique.mockResolvedValue(null);
      // 原价 2250 分，整单优惠到 2000 分
      transactionClient.scanOrders.findUniqueOrThrow.mockResolvedValue(
        buildOrder({ payableAmount: 2000 }),
      );

      await service.createForPaidOrder(transactionClient, 1001, 'wechat');

      const [, dto] = salesRecordService.create.mock.calls[0];
      const totalFen = (dto.items as Array<{ salePrice: number }>).reduce(
        (sum, item) => sum + Math.round(item.salePrice * 100),
        0,
      );
      expect(totalFen).toBe(2000);
    });

    it('明细行尾差（舍入误差）由最后一明细吸收', async () => {
      transactionClient.saleOrder.findUnique.mockResolvedValue(null);
      // 1 件 100 分商品拆成 3 份时无法整除，payableAmount 必须精确覆盖
      transactionClient.scanOrders.findUniqueOrThrow.mockResolvedValue(
        buildOrder({
          payableAmount: 100,
          items: [
            {
              productNameSnapshot: 'A',
              categoryNameSnapshot: '测试',
              quantity: 3,
              payableLineAmount: 100,
              menuProduct: { productId: 901 },
            },
          ],
        }),
      );

      await service.createForPaidOrder(transactionClient, 1001, 'wechat');

      const [, dto] = salesRecordService.create.mock.calls[0];
      const salePrices = (dto.items as Array<{ salePrice: number }>).map(
        (item) => Math.round(item.salePrice * 100),
      );
      expect(salePrices.reduce((sum, price) => sum + price, 0)).toBe(100);
    });
  });

  describe('服务端权威成交价', () => {
    it('以订单最终应付金额为准，前端明细金额不直接透传', async () => {
      transactionClient.saleOrder.findUnique.mockResolvedValue(null);
      transactionClient.scanOrders.findUniqueOrThrow.mockResolvedValue(
        buildOrder({ payableAmount: 1999 }),
      );

      await service.createForPaidOrder(transactionClient, 1001, 'wechat');

      const [, dto] = salesRecordService.create.mock.calls[0];
      const totalFen = (dto.items as Array<{ salePrice: number }>).reduce(
        (sum, item) => sum + Math.round(item.salePrice * 100),
        0,
      );
      // 总应付 1999 分，而不是 2250 分
      expect(totalFen).toBe(1999);
    });

    it('调用标准销售创建时传入 skipInventoryValidationAndDeduction 与 preserveCallerSalePrices', async () => {
      transactionClient.saleOrder.findUnique.mockResolvedValue(null);
      transactionClient.scanOrders.findUniqueOrThrow.mockResolvedValue(
        buildOrder(),
      );

      await service.createForPaidOrder(transactionClient, 1001, 'wechat');

      const [, , options] = salesRecordService.create.mock.calls[0];
      expect(options).toMatchObject({
        skipAccessCheck: true,
        skipInventoryValidationAndDeduction: true,
        preserveCallerSalePrices: true,
        scanOrderId: 1001,
      });
      expect(options.transactionClient).toBe(transactionClient);
    });

    it('创建时传系统用户与支付方式、订单备注', async () => {
      transactionClient.saleOrder.findUnique.mockResolvedValue(null);
      transactionClient.scanOrders.findUniqueOrThrow.mockResolvedValue(
        buildOrder({ remark: '不要辣' }),
      );

      await service.createForPaidOrder(transactionClient, 1001, 'other');

      const [user, dto] = salesRecordService.create.mock.calls[0];
      expect(user.id).toBe(0);
      expect(user.name).toBe('扫码点餐系统');
      expect(dto.paymentMethod).toBe('other');
      expect(dto.storeId).toBe(11);
      expect(dto.note).toContain('SO20260803001');
      expect(dto.note).toContain('不要辣');
    });
  });

  describe('利润处理', () => {
    it('桥接层不传前端利润（profit = 0），利润由标准销售按成本推导', async () => {
      transactionClient.saleOrder.findUnique.mockResolvedValue(null);
      transactionClient.scanOrders.findUniqueOrThrow.mockResolvedValue(
        buildOrder(),
      );

      await service.createForPaidOrder(transactionClient, 1001, 'wechat');

      const [, dto] = salesRecordService.create.mock.calls[0];
      for (const item of dto.items) {
        expect(item.profit).toBe(0);
      }
    });
  });
});
