import { FinanceCashFlowPayment } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';
import { SalesRecordRefundService } from './sales-record-refund.service';

describe('SalesRecordRefundService', () => {
  let service: SalesRecordRefundService;

  /** 部分字段的事务替身：仅需满足被测方法实际访问的模型即可，故做一次显式收窄 */
  const asTransactionClient = (tx: unknown): Prisma.TransactionClient =>
    tx as Prisma.TransactionClient;

  const transactionClient = {
    saleOrder: {
      findUniqueOrThrow: jest.fn(),
    },
    saleOrderRefund: {
      create: jest.fn(),
    },
    financeCashFlowRecord: {
      create: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    transactionClient.saleOrderRefund.create.mockResolvedValue({ id: 77 });
    transactionClient.financeCashFlowRecord.create.mockResolvedValue({});

    const module: TestingModule = await Test.createTestingModule({
      providers: [SalesRecordRefundService],
    }).compile();

    service = module.get<SalesRecordRefundService>(SalesRecordRefundService);
  });

  /**
   * 部分字段的销售单替身：退款金额由明细行推导，故这里必须给出 items。
   * 默认两行普通商品：营业额 2250 分、利润 800 分（与既有断言一致）。
   */
  const buildSaleOrder = (
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> => ({
    id: 500,
    storeId: 11,
    items: [
      { productName: '橙汁', salePrice: 1500, profit: 600, quantity: 1 },
      { productName: '薯条', salePrice: 750, profit: 200, quantity: 1 },
    ],
    paymentMethod: 'wechat',
    refund: null,
    ...overrides,
  });

  describe('幂等', () => {
    it('已有 SaleOrderRefund 时直接返回，不重复创建退款与财务流水', async () => {
      transactionClient.saleOrder.findUniqueOrThrow.mockResolvedValue(
        buildSaleOrder({ refund: { id: 77 } }),
      );

      await service.refundInTransaction(
        asTransactionClient(transactionClient),
        {
          saleOrderId: 500,
          refundedAt: new Date('2026-08-03T11:00:00.000Z'),
        },
      );

      expect(transactionClient.saleOrderRefund.create).not.toHaveBeenCalled();
      expect(
        transactionClient.financeCashFlowRecord.create,
      ).not.toHaveBeenCalled();
    });
  });

  describe('唯一退款与财务流水', () => {
    it('创建唯一 SaleOrderRefund，金额/利润/支付方式/退款时间取自销售单', async () => {
      const refundedAt = new Date('2026-08-03T11:00:00.000Z');
      transactionClient.saleOrder.findUniqueOrThrow.mockResolvedValue(
        buildSaleOrder(),
      );

      await service.refundInTransaction(
        asTransactionClient(transactionClient),
        {
          saleOrderId: 500,
          refundedAt,
        },
      );

      expect(transactionClient.saleOrderRefund.create).toHaveBeenCalledTimes(1);
      expect(transactionClient.saleOrderRefund.create).toHaveBeenCalledWith({
        data: {
          saleOrderId: 500,
          storeId: 11,
          amount: 2250,
          profit: 800,
          paymentMethod: 'wechat',
          refundedAt,
        },
        select: { id: true },
      });
    });

    it('创建唯一财务退款流水（direction=expense, category=refund）并关联 refundId', async () => {
      const refundedAt = new Date('2026-08-03T11:00:00.000Z');
      transactionClient.saleOrder.findUniqueOrThrow.mockResolvedValue(
        buildSaleOrder(),
      );
      transactionClient.saleOrderRefund.create.mockResolvedValue({ id: 88 });

      await service.refundInTransaction(
        asTransactionClient(transactionClient),
        {
          saleOrderId: 500,
          refundedAt,
        },
      );

      expect(
        transactionClient.financeCashFlowRecord.create,
      ).toHaveBeenCalledTimes(1);
      expect(
        transactionClient.financeCashFlowRecord.create,
      ).toHaveBeenCalledWith({
        data: {
          storeId: 11,
          saleOrderRefundId: 88,
          direction: 'expense',
          category: 'refund',
          title: expect.stringContaining('500'),
          amount: 2250,
          payment: FinanceCashFlowPayment.wechat,
          note: '标准销售退款冲销',
          date: refundedAt,
        },
      });
    });

    it('含抵扣行时按净额退款，不把抵扣（券面）金额退给客人', async () => {
      const refundedAt = new Date('2026-08-03T11:00:00.000Z');
      // 纯消费模式开台团购券：券面既计入消费也等额冲抵，
      // 客人现场只付了点单的 88 元，退款必须退 88 而不是营业额 276.70。
      transactionClient.saleOrder.findUniqueOrThrow.mockResolvedValue(
        buildSaleOrder({
          items: [
            {
              productName: '分手大师（团购券）',
              salePrice: 18870,
              profit: 18870,
              quantity: 1,
            },
            { productName: '橙汁', salePrice: 8800, profit: 4000, quantity: 1 },
            {
              productName: '预付款',
              salePrice: 18870,
              profit: 18870,
              quantity: 1,
            },
          ],
        }),
      );

      await service.refundInTransaction(
        asTransactionClient(transactionClient),
        { saleOrderId: 500, refundedAt },
      );

      expect(transactionClient.saleOrderRefund.create).toHaveBeenCalledWith({
        data: {
          saleOrderId: 500,
          storeId: 11,
          amount: 8800,
          profit: 4000,
          paymentMethod: 'wechat',
          refundedAt,
        },
        select: { id: true },
      });
    });

    it('groupon_voucher 支付方式映射为财务 other', async () => {
      const refundedAt = new Date('2026-08-03T11:00:00.000Z');
      transactionClient.saleOrder.findUniqueOrThrow.mockResolvedValue(
        buildSaleOrder({ paymentMethod: 'groupon_voucher' }),
      );

      await service.refundInTransaction(
        asTransactionClient(transactionClient),
        {
          saleOrderId: 500,
          refundedAt,
        },
      );

      expect(
        transactionClient.financeCashFlowRecord.create,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            payment: FinanceCashFlowPayment.other,
          }),
        }),
      );
    });
  });
});
