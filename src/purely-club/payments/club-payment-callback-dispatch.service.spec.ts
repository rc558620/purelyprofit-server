import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ClubOrderServicePaymentService } from '../orders/club-order-service-payment.service';
import { ClubRechargePaymentService } from '../recharge/club-recharge-payment.service';
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
      ],
    }).compile();

    service = module.get<ClubPaymentCallbackDispatchService>(
      ClubPaymentCallbackDispatchService,
    );
  });

  it('dispatchByOrderNo 在 RC 前缀时驱动充值支付服务', async () => {
    clubRechargePaymentService.confirmOrderPaidByCallback.mockResolvedValue({
      orderNo: 'RC123',
      orderType: 'recharge',
      status: 'paid',
    });

    await expect(
      service.dispatchByOrderNo('RC123', settlement),
    ).resolves.toEqual({
      orderNo: 'RC123',
      orderType: 'recharge',
      status: 'paid',
    });
    expect(
      clubRechargePaymentService.confirmOrderPaidByCallback,
    ).toHaveBeenCalledWith('RC123', settlement);
    expect(
      clubOrderServicePaymentService.confirmOrderPaidByCallback,
    ).not.toHaveBeenCalled();
  });

  it('dispatchByOrderNo 在 SV 前缀时驱动服务支付服务', async () => {
    clubOrderServicePaymentService.confirmOrderPaidByCallback.mockResolvedValue(
      {
        orderNo: 'SV123',
        orderType: 'service',
        status: 'paid',
      },
    );

    await expect(
      service.dispatchByOrderNo('SV123', {
        ...settlement,
        amountFen: 49900,
        transactionId: '4200001234202606109999999999',
      }),
    ).resolves.toEqual({
      orderNo: 'SV123',
      orderType: 'service',
      status: 'paid',
    });
    expect(
      clubOrderServicePaymentService.confirmOrderPaidByCallback,
    ).toHaveBeenCalledWith(
      'SV123',
      expect.objectContaining({ amountFen: 49900 }),
    );
    expect(
      clubRechargePaymentService.confirmOrderPaidByCallback,
    ).not.toHaveBeenCalled();
  });

  it('dispatchByOrderNo 在未知前缀时抛出 BadRequestException', () => {
    expect(() => service.dispatchByOrderNo('XX123', settlement)).toThrow(
      BadRequestException,
    );
  });
});
