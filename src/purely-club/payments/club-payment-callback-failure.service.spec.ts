import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AlertService } from '../../shared/alert/alert.service';
import { ClubPaymentCallbackFailureService } from './club-payment-callback-failure.service';

describe('ClubPaymentCallbackFailureService', () => {
  const prismaService = {
    clubPaymentCallbackFailure: {
      upsert: jest.fn().mockResolvedValue({ id: 1 }),
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    clubRechargeOrder: {
      findUnique: jest.fn().mockResolvedValue({ storeId: 11 }),
    },
  };
  const alertService = { send: jest.fn().mockResolvedValue(undefined) };

  let service: ClubPaymentCallbackFailureService;

  const settlementParams = {
    amountFen: 50000,
    transactionId: 'wxTx123',
    paidAtMs: 1773558663000,
    callbackReceivedAtMs: 1773558664000,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    alertService.send.mockResolvedValue(undefined);
    prismaService.clubPaymentCallbackFailure.upsert.mockResolvedValue({
      id: 1,
    });
    prismaService.clubRechargeOrder.findUnique.mockResolvedValue({
      storeId: 11,
    });

    service = new ClubPaymentCallbackFailureService(
      prismaService as unknown as PrismaService,
      alertService as unknown as AlertService,
    );
  });

  // D8：重试耗尽是「钱已扣、余额未到账」，必须落库 + 告警，不能只打日志
  it('重试耗尽时落死信并触发告警', async () => {
    await service.recordRetryExhausted({
      orderNo: 'RC202606101231000001A2B',
      attempts: 5,
      reason: '订单不存在',
      settlementParams,
    });

    expect(
      prismaService.clubPaymentCallbackFailure.upsert,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { orderNo: 'RC202606101231000001A2B' },
        create: expect.objectContaining({
          orderNo: 'RC202606101231000001A2B',
          orderType: 'recharge',
          storeId: 11,
          transactionId: 'wxTx123',
          amountFen: 50000,
          attempts: 5,
        }),
      }),
    );
    expect(alertService.send).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'error' }),
    );
  });

  it('订单号前缀无法识别时记为 unknown，不阻断死信入库', async () => {
    await service.recordRetryExhausted({
      orderNo: 'UNKNOWN-PREFIX-1',
      attempts: 5,
      reason: '落账失败',
      settlementParams,
    });

    expect(
      prismaService.clubPaymentCallbackFailure.upsert,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          orderType: 'unknown',
          storeId: null,
        }),
      }),
    );
  });

  it('处理不存在的死信时抛 NotFoundException', async () => {
    prismaService.clubPaymentCallbackFailure.findUnique.mockResolvedValue(null);

    await expect(
      service.resolve({ id: 999, status: 'resolved', operatorId: 1 }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('标记 dead letter 已处理时写入处理人与备注', async () => {
    prismaService.clubPaymentCallbackFailure.findUnique.mockResolvedValue({
      id: 1,
    });
    prismaService.clubPaymentCallbackFailure.update.mockResolvedValue({
      id: 1,
      orderNo: 'RC202606101231000001A2B',
      orderType: 'recharge',
      storeId: 11,
      transactionId: 'wxTx123',
      amountFen: 50000,
      reason: '订单不存在',
      attempts: 5,
      status: 'resolved',
      resolutionNote: '已人工补单',
      createdAt: new Date(),
      resolvedAt: new Date(),
    });

    await expect(
      service.resolve({
        id: 1,
        status: 'resolved',
        note: '已人工补单',
        operatorId: 9,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        status: 'resolved',
        resolutionNote: '已人工补单',
      }),
    );

    expect(
      prismaService.clubPaymentCallbackFailure.update,
    ).toHaveBeenCalledWith({
      where: { id: 1 },
      data: expect.objectContaining({
        status: 'resolved',
        resolutionNote: '已人工补单',
        resolvedBy: 9,
      }),
    });
  });
});
