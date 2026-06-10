import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ClubOrdersService } from '../orders/club-orders.service';
import { ClubRechargeService } from '../recharge/club-recharge.service';
import { ClubPaymentsService } from './club-payments.service';

describe('ClubPaymentsService', () => {
  let service: ClubPaymentsService;

  const configService = {
    get: jest.fn((key: string) => {
      const configMap: Record<string, string | number> = {
        'club.wechatCallbackSecret': 'callback-secret',
        'club.wechatCallbackMaxAgeSeconds': 300,
      };
      return configMap[key];
    }),
  };

  const clubRechargeService = {
    confirmOrderPaidByCallback: jest.fn(),
  };

  const clubOrdersService = {
    confirmOrderPaidByCallback: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClubPaymentsService,
        { provide: ConfigService, useValue: configService },
        { provide: ClubRechargeService, useValue: clubRechargeService },
        { provide: ClubOrdersService, useValue: clubOrdersService },
      ],
    }).compile();

    service = module.get<ClubPaymentsService>(ClubPaymentsService);
  });

  it('handleWechatCallback 在充值回调验签通过后驱动充值落账', async () => {
    const payload = {
      orderNo: 'RC123',
      orderType: 'recharge' as const,
      amountFen: 50000,
      transactionId: '4200001234202606101234567890',
      status: 'SUCCESS' as const,
      paidAt: '2026-06-10T12:31:00.000Z',
    };
    const headers = createSignedHeaders(service, payload);
    clubRechargeService.confirmOrderPaidByCallback.mockResolvedValue({
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
    expect(clubRechargeService.confirmOrderPaidByCallback).toHaveBeenCalledWith(
      'RC123',
      expect.objectContaining({
        amountFen: 50000,
        transactionId: '4200001234202606101234567890',
      }),
    );
  });

  it('handleWechatCallback 在服务购买回调验签通过后驱动服务落账', async () => {
    const payload = {
      orderNo: 'SV123',
      orderType: 'service' as const,
      amountFen: 49900,
      transactionId: '4200001234202606109999999999',
      status: 'SUCCESS' as const,
    };
    const headers = createSignedHeaders(service, payload);
    clubOrdersService.confirmOrderPaidByCallback.mockResolvedValue({
      orderNo: 'SV123',
      orderType: 'service',
      status: 'paid',
    });

    await expect(service.handleWechatCallback(payload, headers)).resolves.toEqual({
      success: true,
      orderNo: 'SV123',
      orderType: 'service',
      status: 'paid',
    });
    expect(clubOrdersService.confirmOrderPaidByCallback).toHaveBeenCalledWith(
      'SV123',
      expect.objectContaining({
        amountFen: 49900,
        transactionId: '4200001234202606109999999999',
      }),
    );
  });

  it('handleWechatCallback 在签名不合法时拒绝回调', async () => {
    const payload = {
      orderNo: 'RC123',
      orderType: 'recharge' as const,
      amountFen: 50000,
      transactionId: '4200001234202606101234567890',
      status: 'SUCCESS' as const,
    };

    await expect(
      service.handleWechatCallback(payload, {
        timestamp: String(Math.floor(Date.now() / 1000)),
        nonce: 'nonce',
        signature: 'BAD_SIGNATURE',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('handleWechatCallback 在 paidAt 非法时抛出 BadRequestException', async () => {
    const payload = {
      orderNo: 'RC123',
      orderType: 'recharge' as const,
      amountFen: 50000,
      transactionId: '4200001234202606101234567890',
      status: 'SUCCESS' as const,
      paidAt: 'not-a-date',
    };
    const headers = createSignedHeaders(service, payload);

    await expect(service.handleWechatCallback(payload, headers)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

function createSignedHeaders(
  service: ClubPaymentsService,
  payload: {
    orderNo: string;
    orderType: 'recharge' | 'service';
    amountFen: number;
    transactionId: string;
    status: 'SUCCESS';
    paidAt?: string;
  },
): {
  timestamp: string;
  nonce: string;
  signature: string;
} {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = 'callback-nonce';
  const signature = (service as unknown as {
    buildSignature: (params: {
      timestamp: string;
      nonce: string;
      payload: typeof payload;
      secret: string;
    }) => string;
  }).buildSignature({
    timestamp,
    nonce,
    payload,
    secret: 'callback-secret',
  });

  return {
    timestamp,
    nonce,
    signature,
  };
}
