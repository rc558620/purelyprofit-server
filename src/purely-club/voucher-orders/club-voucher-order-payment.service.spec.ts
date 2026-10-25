// 团购券下单幂等的回归用例：同一幂等键重复提交只能有一单，且不重复算价/下单
import type { ClubCurrentContext } from '../stores/club-stores.types';
import type { ClubNewCustomerQuotaService } from '../shared/club-new-customer-quota.service';
import type { ClubOrderIdempotencyService } from '../shared/club-order-idempotency.service';
import type { ClubOrderPreviewBreakdownService } from '../orders/club-order-preview-breakdown.service';
import type { ClubWechatJsapiService } from '../payments/club-wechat-jsapi.service';
import type { ClubWechatOpenidService } from '../payments/club-wechat-openid.service';
import type { ClubPaymentModeService } from '../payments/club-payment-mode.service';
import type { CacheInvalidatorService } from '../../redis/cache-invalidator.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { ScanOrderingRealtimeService } from '../scan-ordering/scan-ordering-realtime.service';
import { ClubVoucherOrderPaymentService } from './club-voucher-order-payment.service';
import type { ClubVoucherOrderContextService } from './club-voucher-order-context.service';
import type { CreateClubVoucherOrderDto } from './dto/club-voucher-order.dto';

describe('ClubVoucherOrderPaymentService 幂等', () => {
  const prisma = {
    clubVoucherOrder: { findFirst: jest.fn() },
    // 落账走 $transaction，这里只用于证明确实进入了落账流程
    $transaction: jest.fn(),
  };
  const clubPaymentModeService = {
    isManualConfirmPaidAllowed: jest.fn(),
  };
  const contextService = {
    resolveContext: jest.fn(),
  };
  const clubWechatJsapiService = {
    createJsapiPaymentParams: jest.fn(),
  };
  const breakdownService = { build: jest.fn() };
  const realtimeService = { emitVoucherOrderPaid: jest.fn() };
  const cacheInvalidatorService = {
    invalidateMarketingOverview: jest.fn(),
    invalidateMembersDerived: jest.fn(),
    invalidateMarketingCustomerDerived: jest.fn(),
  };
  const quotaService = { consumeWithinOrderTransaction: jest.fn() };
  const clubWechatOpenidService = {
    resolveOpenid: jest.fn(),
  };
  const idempotencyService = {
    normalizeKey: jest.fn(),
    findOrderNo: jest.fn(),
    reserve: jest.fn(),
    release: jest.fn(),
  };

  const currentContext = {
    user: { id: 7, phone: '13800000000' },
  } as unknown as ClubCurrentContext;
  const dto = {
    storeId: 11,
    productId: 21,
    quantity: 1,
  } as unknown as CreateClubVoucherOrderDto;

  let service: ClubVoucherOrderPaymentService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ClubVoucherOrderPaymentService(
      prisma as unknown as PrismaService,
      clubPaymentModeService as unknown as ClubPaymentModeService,
      contextService as unknown as ClubVoucherOrderContextService,
      clubWechatJsapiService as unknown as ClubWechatJsapiService,
      breakdownService as unknown as ClubOrderPreviewBreakdownService,
      realtimeService as unknown as ScanOrderingRealtimeService,
      cacheInvalidatorService as unknown as CacheInvalidatorService,
      quotaService as unknown as ClubNewCustomerQuotaService,
      clubWechatOpenidService as unknown as ClubWechatOpenidService,
      idempotencyService as unknown as ClubOrderIdempotencyService,
    );
  });

  it('幂等键命中已建订单时直接复用，不再算价与微信下单', async () => {
    idempotencyService.normalizeKey.mockReturnValue('idem-voucher-001');
    prisma.clubVoucherOrder.findFirst.mockResolvedValue({
      orderNo: 'VC20261025000001',
      status: 'unpaid',
      paidAmountFen: 9900,
      voucherCode: null,
    });

    const result = await service.createVoucherOrder(
      currentContext,
      dto,
      'idem-voucher-001',
    );

    expect(result).toEqual(
      expect.objectContaining({
        orderNo: 'VC20261025000001',
        amountFen: 9900,
        reused: true,
      }),
    );
    // 复用不应产生第二笔支付参数，也不应重新解析商品/算价
    expect(result.paymentParams).toBeUndefined();
    expect(contextService.resolveContext).not.toHaveBeenCalled();
    expect(idempotencyService.reserve).not.toHaveBeenCalled();
  });

  it('未带幂等键时不做复用查询，保持旧行为', async () => {
    idempotencyService.normalizeKey.mockReturnValue(null);
    // 走到解析商品即抛错，用于证明没有命中幂等分支（不会去查库）
    contextService.resolveContext.mockRejectedValue(
      new Error('resolve-context-stub'),
    );

    await expect(
      service.createVoucherOrder(currentContext, dto),
    ).rejects.toThrow('resolve-context-stub');

    expect(prisma.clubVoucherOrder.findFirst).not.toHaveBeenCalled();
  });

  it('手动确认支付被闸门关闭时直接拒绝，且不查订单', async () => {
    clubPaymentModeService.isManualConfirmPaidAllowed.mockResolvedValue(false);

    await expect(
      service.confirmOrderPaid(currentContext, 'VC20261025000001'),
    ).rejects.toThrow('当前环境未开启手动确认支付');

    expect(prisma.clubVoucherOrder.findFirst).not.toHaveBeenCalled();
  });

  it('测试模式允许手动确认支付时进入落账事务', async () => {
    clubPaymentModeService.isManualConfirmPaidAllowed.mockResolvedValue(true);
    prisma.clubVoucherOrder.findFirst.mockResolvedValue({
      id: 1,
      orderNo: 'VC20261025000001',
      paidAmountFen: 9900,
    });
    prisma.$transaction.mockRejectedValue(new Error('settle-probe'));

    await expect(
      service.confirmOrderPaid(currentContext, 'VC20261025000001'),
    ).rejects.toThrow('settle-probe');

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});
