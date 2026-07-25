import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ClubOrderServicePaymentService } from '../orders/club-order-service-payment.service';
import { ClubRechargePaymentService } from '../recharge/club-recharge-payment.service';
import { ClubScanOrderingPaymentService } from '../scan-ordering/club-scan-ordering-payment.service';
import { ClubPaymentCallbackDispatchService } from './club-payment-callback-dispatch.service';
import type { ClubPaymentCallbackSettlementParams } from './club-payments.types';

describe('ClubPaymentCallbackDispatchService', () => {
  let service: ClubPaymentCallbackDispatchService;

  const clubRechargePaymentService = {
    confirmOrderPaidByCallback: jest.fn(),
  };

  const clubOrderServicePaymentService = {
    confirmOrderPaidByCallback: jest.fn(),
  };

  const clubScanOrderingPaymentService = {
    confirmOrderPaidByCallback: jest.fn(),
  };

  const settlement: ClubPaymentCallbackSettlementParams = {
    amountFen: 50000,
    transactionId: '4200001234202606101234567890',
    paidAtMs: Date.now(),
    callbackReceivedAtMs: Date.now(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClubPaymentCallbackDispatchService,
        {
          provide: ClubRechargePaymentService,
          useValue: clubRechargePaymentService,
        },
        {
          provide: ClubOrderServicePaymentService,
          useValue: clubOrderServicePaymentService,
        },
        {
          provide: ClubScanOrderingPaymentService,
          useValue: clubScanOrderingPaymentService,
        },
      ],
    }).compile();

    service = module.get<ClubPaymentCallbackDispatchService>(
      ClubPaymentCallbackDispatchService,
    );
  });

  it('dispatchByOrderNo 在 RC 前缀时驱动充值支付服务', async () => {
    clubRechargePaymentService.confirmOrderPaidByCallback.mockResolvedValue({
      orderNo: 'RC202606101231000001A2B',
      orderType: 'recharge',
      status: 'paid',
    });

    await expect(
      service.dispatchByOrderNo('RC202606101231000001A2B', settlement),
    ).resolves.toEqual({
      orderNo: 'RC202606101231000001A2B',
      orderType: 'recharge',
      status: 'paid',
    });
    expect(
      clubRechargePaymentService.confirmOrderPaidByCallback,
    ).toHaveBeenCalledWith('RC202606101231000001A2B', settlement);
    expect(
      clubOrderServicePaymentService.confirmOrderPaidByCallback,
    ).not.toHaveBeenCalled();
  });

  it('dispatchByOrderNo 在 SV 前缀时驱动服务支付服务', async () => {
    clubOrderServicePaymentService.confirmOrderPaidByCallback.mockResolvedValue(
      {
        orderNo: 'SV202606101231000003C4D',
        orderType: 'service',
        status: 'paid',
      },
    );

    await expect(
      service.dispatchByOrderNo('SV202606101231000003C4D', {
        ...settlement,
        amountFen: 49900,
        transactionId: '4200001234202606109999999999',
      }),
    ).resolves.toEqual({
      orderNo: 'SV202606101231000003C4D',
      orderType: 'service',
      status: 'paid',
    });
    expect(
      clubOrderServicePaymentService.confirmOrderPaidByCallback,
    ).toHaveBeenCalledWith(
      'SV202606101231000003C4D',
      expect.objectContaining({ amountFen: 49900 }),
    );
    expect(
      clubRechargePaymentService.confirmOrderPaidByCallback,
    ).not.toHaveBeenCalled();
  });

  it('dispatchByOrderNo 在 SO 前缀时驱动扫码点餐支付服务', async () => {
    clubScanOrderingPaymentService.confirmOrderPaidByCallback.mockResolvedValue(
      {
        orderNo: 'SO20260723123000ABCD-1A2B3C4D',
        orderType: 'scan_ordering',
        status: 'pending_acceptance',
      },
    );

    await expect(
      service.dispatchByOrderNo('SO20260723123000ABCD-1A2B3C4D', settlement),
    ).resolves.toEqual({
      orderNo: 'SO20260723123000ABCD-1A2B3C4D',
      orderType: 'scan_ordering',
      status: 'pending_acceptance',
    });
    expect(
      clubScanOrderingPaymentService.confirmOrderPaidByCallback,
    ).toHaveBeenCalledWith('SO20260723123000ABCD-1A2B3C4D', settlement);
  });

  it('dispatchByOrderNo 在未知前缀时抛出 BadRequestException', () => {
    expect(() => service.dispatchByOrderNo('XX123', settlement)).toThrow(
      BadRequestException,
    );
  });
});
