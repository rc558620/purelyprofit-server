import { PrismaService } from '../../../prisma/prisma.service';
import { SmsDeliveryCallbackService } from './sms-delivery-callback.service';
import { SmsDeliveryReconcileService } from './sms-delivery-reconcile.service';
import { SmsRefundService } from './sms-refund.service';
import { SmsTencentProvider } from './sms-tencent.provider';

describe('SmsDeliveryReconcileService', () => {
  let service: SmsDeliveryReconcileService;
  let prisma: { smsBroadcastRecipient: { findMany: jest.Mock } };
  let provider: { pullSmsSendStatus: jest.Mock };
  let callbackService: { handleCallback: jest.Mock };
  let refundService: { refundUndeliveredFailures: jest.Mock };

  beforeEach(() => {
    prisma = {
      smsBroadcastRecipient: { findMany: jest.fn().mockResolvedValue([]) },
    };
    provider = { pullSmsSendStatus: jest.fn().mockResolvedValue([]) };
    callbackService = {
      handleCallback: jest.fn().mockResolvedValue({
        received: 0,
        matched: 0,
        unmatched: 0,
        delivered: 0,
        failed: 0,
        duplicated: 0,
        unknown: 0,
        refundedFen: 0,
      }),
    };
    refundService = {
      refundUndeliveredFailures: jest
        .fn()
        .mockResolvedValue({ recipients: 0, amountFen: 0 }),
    };

    service = new SmsDeliveryReconcileService(
      prisma as unknown as PrismaService,
      provider as unknown as SmsTencentProvider,
      callbackService as unknown as SmsDeliveryCallbackService,
      refundService as unknown as SmsRefundService,
    );
  });

  it('没有待核销明细时不打扰通道', async () => {
    const reconciled = await service.reconcileMissingDelivery();

    expect(reconciled).toBe(0);
    expect(provider.pullSmsSendStatus).not.toHaveBeenCalled();
  });

  it('只核销「已超过等待窗口但仍在追溯期内」的明细', async () => {
    prisma.smsBroadcastRecipient.findMany.mockResolvedValue([
      { serialNo: 'sn-1', status: 'success', createdAt: new Date() },
    ]);

    await service.reconcileMissingDelivery();

    const where = prisma.smsBroadcastRecipient.findMany.mock.calls[0][0].where;
    expect(where.deliveryStatus).toBeNull();
    // 有流水号（发出去了）才需要核销
    expect(where.serialNo).toEqual({ not: null });
    expect(where.createdAt.gte).toBeInstanceOf(Date);
    expect(where.createdAt.lte).toBeInstanceOf(Date);
    // 等待窗口必须早于追溯上限，否则区间为空、永远核销不到
    expect(where.createdAt.gte.getTime()).toBeLessThan(
      where.createdAt.lte.getTime(),
    );
  });

  it('拉回来的结果按流水号过滤，不给无关群发乱退钱', async () => {
    prisma.smsBroadcastRecipient.findMany.mockResolvedValue([
      { serialNo: 'sn-1', status: 'success', createdAt: new Date() },
    ]);
    provider.pullSmsSendStatus.mockResolvedValue([
      { SerialNo: 'sn-other', ReportStatus: 'UNDELIV' },
      { SerialNo: 'sn-1', ReportStatus: 'UNDELIV', Description: '空号' },
    ]);
    callbackService.handleCallback.mockResolvedValue({
      received: 1,
      matched: 1,
      unmatched: 0,
      delivered: 0,
      failed: 1,
      duplicated: 0,
      unknown: 0,
      refundedFen: 10,
    });

    const reconciled = await service.reconcileMissingDelivery();

    expect(reconciled).toBe(1);
    const forwarded = callbackService.handleCallback.mock.calls[0][0];
    expect(forwarded).toHaveLength(1);
    expect(forwarded[0].SerialNo).toBe('sn-1');
  });

  it('通道拉不到数据时安全返回，不做任何退费动作', async () => {
    prisma.smsBroadcastRecipient.findMany.mockResolvedValue([
      { serialNo: 'sn-1', status: 'success', createdAt: new Date() },
    ]);
    provider.pullSmsSendStatus.mockResolvedValue([]);

    const reconciled = await service.reconcileMissingDelivery();

    expect(reconciled).toBe(0);
    expect(callbackService.handleCallback).not.toHaveBeenCalled();
  });

  it('拉取到的回执全部与本次无关时也不走退费链路', async () => {
    prisma.smsBroadcastRecipient.findMany.mockResolvedValue([
      { serialNo: 'sn-1', status: 'success', createdAt: new Date() },
    ]);
    provider.pullSmsSendStatus.mockResolvedValue([
      { SerialNo: 'sn-x', ReportStatus: 'UNDELIV' },
    ]);

    const reconciled = await service.reconcileMissingDelivery();

    expect(reconciled).toBe(0);
    expect(callbackService.handleCallback).not.toHaveBeenCalled();
  });

  it('兼容拉取结果里的大小写字段名变化（SerialNo / serialNo）', async () => {
    prisma.smsBroadcastRecipient.findMany.mockResolvedValue([
      { serialNo: 'sn-2', status: 'success', createdAt: new Date() },
    ]);
    provider.pullSmsSendStatus.mockResolvedValue([
      { serialNo: 'sn-2', ReportStatus: 'SUCCESS' },
    ]);
    callbackService.handleCallback.mockResolvedValue({
      received: 1,
      matched: 1,
      unmatched: 0,
      delivered: 1,
      failed: 0,
      duplicated: 0,
      unknown: 0,
      refundedFen: 0,
    });

    const reconciled = await service.reconcileMissingDelivery();

    expect(reconciled).toBe(1);
  });

  it('补到回执走的是回调那条已验证的处理链路，不重复实现退费', async () => {
    prisma.smsBroadcastRecipient.findMany.mockResolvedValue([
      { serialNo: 'sn-1', status: 'success', createdAt: new Date() },
    ]);
    provider.pullSmsSendStatus.mockResolvedValue([
      { SerialNo: 'sn-1', ReportStatus: 'UNDELIV' },
    ]);
    callbackService.handleCallback.mockResolvedValue({
      received: 1,
      matched: 1,
      unmatched: 0,
      delivered: 0,
      failed: 1,
      duplicated: 0,
      unknown: 0,
      refundedFen: 10,
    });

    const reconciled = await service.reconcileMissingDelivery();

    expect(reconciled).toBe(1);
    expect(callbackService.handleCallback).toHaveBeenCalledTimes(1);
  });
});
