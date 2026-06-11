import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ClubOrderServicePaymentService } from '../orders/club-order-service-payment.service';
import { ClubRechargePaymentService } from '../recharge/club-recharge-payment.service';
import { ClubPaymentCallbackDispatchService } from './club-payment-callback-dispatch.service';

describe('ClubPaymentCallbackDispatchService', () => {
  let service: ClubPaymentCallbackDispatchService;

  const clubRechargePaymentService = {
    confirmOrderPaidByCallback: jest.fn(),
  };

  const clubOrderServicePaymentService = {
    confirmOrderPaidByCallback: jest.fn(),
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

  it('dispatchWechatCallback 在 recharge 订单时驱动充值支付服务', async () => {
    const payload = {
      orderNo: 'RC123',
      orderType: 'recharge' as const,
      amountFen: 50000,
      transactionId: '4200001234202606101234567890',
      status: 'SUCCESS' as const,
      paidAt: '2026-06-10T12:31:00.000Z',
    };
    clubRechargePaymentService.confirmOrderPaidByCallback.mockResolvedValue({
      orderNo: 'RC123',
      orderType: 'recharge',
      status: 'paid',
    });

    await expect(service.dispatchWechatCallback(payload)).resolves.toEqual({
      orderNo: 'RC123',
      orderType: 'recharge',
      status: 'paid',
    });
    expect(
      clubRechargePaymentService.confirmOrderPaidByCallback,
    ).toHaveBeenCalledWith(
      'RC123',
      expect.objectContaining({
        amountFen: 50000,
        transactionId: '4200001234202606101234567890',
      }),
    );
    expect(
      clubOrderServicePaymentService.confirmOrderPaidByCallback,
    ).not.toHaveBeenCalled();
  });

  it('dispatchWechatCallback 在 service 订单时驱动服务支付服务', async () => {
    const payload = {
      orderNo: 'SV123',
      orderType: 'service' as const,
      amountFen: 49900,
      transactionId: '4200001234202606109999999999',
      status: 'SUCCESS' as const,
    };
    clubOrderServicePaymentService.confirmOrderPaidByCallback.mockResolvedValue(
      {
        orderNo: 'SV123',
        orderType: 'service',
        status: 'paid',
      },
    );

    await expect(service.dispatchWechatCallback(payload)).resolves.toEqual({
      orderNo: 'SV123',
      orderType: 'service',
      status: 'paid',
    });
    expect(
      clubOrderServicePaymentService.confirmOrderPaidByCallback,
    ).toHaveBeenCalledWith(
      'SV123',
      expect.objectContaining({
        amountFen: 49900,
        transactionId: '4200001234202606109999999999',
      }),
    );
    expect(
      clubRechargePaymentService.confirmOrderPaidByCallback,
    ).not.toHaveBeenCalled();
  });

  it('dispatchWechatCallback 在 paidAt 非法时抛出 BadRequestException', () => {
    const payload = {
      orderNo: 'RC123',
      orderType: 'recharge' as const,
      amountFen: 50000,
      transactionId: '4200001234202606101234567890',
      status: 'SUCCESS' as const,
      paidAt: 'not-a-date',
    };

    expect(() => service.dispatchWechatCallback(payload)).toThrow(
      BadRequestException,
    );
    expect(
      clubRechargePaymentService.confirmOrderPaidByCallback,
    ).not.toHaveBeenCalled();
    expect(
      clubOrderServicePaymentService.confirmOrderPaidByCallback,
    ).not.toHaveBeenCalled();
  });
});
