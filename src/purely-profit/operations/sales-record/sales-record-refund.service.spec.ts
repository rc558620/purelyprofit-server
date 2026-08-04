import { FinanceCashFlowPayment } from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';
import { SalesRecordRefundService } from './sales-record-refund.service';

describe('SalesRecordRefundService', () => {
  let service: SalesRecordRefundService;

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

  const buildSaleOrder = (
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> => ({
    id: 500,
    storeId: 11,
    totalRevenue: 2250,
    totalProfit: 800,
    paymentMethod: 'wechat',
    refund: null,
    ...overrides,
  });

  describe('幂等', () => {
    it('已有 SaleOrderRefund 时直接返回，不重复创建退款与财务流水', async () => {
      transactionClient.saleOrder.findUniqueOrThrow.mockResolvedValue(
        buildSaleOrder({ refund: { id: 77 } }),
      );

      await service.refundInTransaction(transactionClient, {
        saleOrderId: 500,
        refundedAt: new Date('2026-08-03T11:00:00.000Z'),
      });

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

      await service.refundInTransaction(transactionClient, {
        saleOrderId: 500,
        refundedAt,
      });

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

      await service.refundInTransaction(transactionClient, {
        saleOrderId: 500,
        refundedAt,
      });

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

    it('groupon_voucher 支付方式映射为财务 other', async () => {
      const refundedAt = new Date('2026-08-03T11:00:00.000Z');
      transactionClient.saleOrder.findUniqueOrThrow.mockResolvedValue(
        buildSaleOrder({ paymentMethod: 'groupon_voucher' }),
      );

      await service.refundInTransaction(transactionClient, {
        saleOrderId: 500,
        refundedAt,
      });

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
