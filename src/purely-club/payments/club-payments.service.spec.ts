import { Test, TestingModule } from '@nestjs/testing';
import { ClubPaymentCallbackDispatchService } from './club-payment-callback-dispatch.service';
import { ClubPaymentCallbackSignatureService } from './club-payment-callback-signature.service';
import { ClubPaymentsService } from './club-payments.service';

describe('ClubPaymentsService', () => {
  let service: ClubPaymentsService;

  const clubPaymentCallbackSignatureService = {
    assertWechatCallbackSignature: jest.fn(),
  };

  const clubPaymentCallbackDispatchService = {
    dispatchWechatCallback: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClubPaymentsService,
        {
          provide: ClubPaymentCallbackSignatureService,
          useValue: clubPaymentCallbackSignatureService,
        },
        {
          provide: ClubPaymentCallbackDispatchService,
          useValue: clubPaymentCallbackDispatchService,
        },
      ],
    }).compile();

    service = module.get<ClubPaymentsService>(ClubPaymentsService);
  });

  it('handleWechatCallback 先验签再分发落账并返回 ack', async () => {
    const payload = {
      orderNo: 'RC123',
      orderType: 'recharge' as const,
      amountFen: 50000,
      transactionId: '4200001234202606101234567890',
      status: 'SUCCESS' as const,
      paidAt: '2026-06-10T12:31:00.000Z',
    };
    const headers = {
      timestamp: '1718000000',
      nonce: 'callback-nonce',
      signature: 'CALLBACK_SIGNATURE',
    };
    clubPaymentCallbackDispatchService.dispatchWechatCallback.mockResolvedValue({
      orderNo: 'RC123',
      orderType: 'recharge',
      status: 'paid',
    });

    await expect(service.handleWechatCallback(payload, headers)).resolves.toEqual({
      success: true,
      orderNo: 'RC123',
      orderType: 'recharge',
      status: 'paid',
    });
    expect(
      clubPaymentCallbackSignatureService.assertWechatCallbackSignature,
    ).toHaveBeenCalledWith(payload, headers);
    expect(
      clubPaymentCallbackDispatchService.dispatchWechatCallback,
    ).toHaveBeenCalledWith(payload);
  });

  it('handleWechatCallback 在验签失败时停止后续分发', async () => {
    const payload = {
      orderNo: 'SV123',
      orderType: 'service' as const,
      amountFen: 49900,
      transactionId: '4200001234202606109999999999',
      status: 'SUCCESS' as const,
    };
    const headers = {
      timestamp: '1718000000',
      nonce: 'callback-nonce',
      signature: 'BAD_SIGNATURE',
    };
    clubPaymentCallbackSignatureService.assertWechatCallbackSignature.mockImplementation(
      () => {
        throw new Error('invalid-signature');
      },
    );

    await expect(service.handleWechatCallback(payload, headers)).rejects.toThrow(
      'invalid-signature',
    );
    expect(
      clubPaymentCallbackDispatchService.dispatchWechatCallback,
    ).not.toHaveBeenCalled();
  });
});
