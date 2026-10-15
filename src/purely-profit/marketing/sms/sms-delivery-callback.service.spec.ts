import { PrismaService } from '../../../prisma/prisma.service';
import { SmsDeliveryCallbackService } from './sms-delivery-callback.service';

/**
 * 送达回执处理测试。
 *
 * 覆盖的是「钱」的路径：腾讯云按送达计费、我们按受理扣费，
 * 所以送达失败必须把差额退回去，且只能退一次。
 */
describe('SmsDeliveryCallbackService', () => {
  const TASK_ID = 777;
  const STORE_ID = 18;
  const RECIPIENT_ID = 5001;

  /** 任务：20 人 × 每人 2 段 = 40 条，单价 5 分 → 扣费 200 分 */
  const buildTask = () => ({
    id: TASK_ID,
    storeId: STORE_ID,
    broadcastId: 'bc_delivery',
    unitPriceFen: 5,
    smsSegments: 40,
    validMobileCount: 20,
    chargedAmountFen: 200,
    autoRefundedFen: 0,
  });

  let service: SmsDeliveryCallbackService;
  let prisma: {
    smsBroadcastRecipient: {
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      groupBy: jest.Mock;
    };
    smsBroadcastTask: { findUnique: jest.Mock; update: jest.Mock };
    storeSmsAccount: {
      updateMany: jest.Mock;
      findUniqueOrThrow: jest.Mock;
    };
    smsWalletLog: { create: jest.Mock };
    $transaction: jest.Mock;
  };
  /** 退费事务里用到的表 */
  type TxClient = {
    smsBroadcastRecipient: { findUnique: jest.Mock; update: jest.Mock };
    smsBroadcastTask: { findUnique: jest.Mock; update: jest.Mock };
    storeSmsAccount: { updateMany: jest.Mock; findUniqueOrThrow: jest.Mock };
    smsWalletLog: { create: jest.Mock };
  };

  let recipient: Record<string, unknown>;
  let tx: TxClient;

  beforeEach(() => {
    recipient = {
      id: RECIPIENT_ID,
      taskId: TASK_ID,
      status: 'success',
      deliveryStatus: null,
      phone: '13800000001',
    };

    tx = {
      smsBroadcastRecipient: {
        findUnique: jest.fn().mockResolvedValue({
          id: RECIPIENT_ID,
          refundedAt: null,
          taskId: TASK_ID,
        }),
        update: jest.fn().mockResolvedValue({ id: RECIPIENT_ID }),
      },
      smsBroadcastTask: {
        findUnique: jest.fn().mockResolvedValue(buildTask()),
        update: jest.fn().mockResolvedValue({ id: TASK_ID }),
      },
      storeSmsAccount: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ balanceFen: 9_900 }),
      },
      smsWalletLog: { create: jest.fn().mockResolvedValue({ id: 1 }) },
    };

    prisma = {
      smsBroadcastRecipient: {
        findFirst: jest.fn().mockResolvedValue(recipient),
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: RECIPIENT_ID, refundedAt: null }),
        update: jest.fn().mockResolvedValue({ id: RECIPIENT_ID }),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      smsBroadcastTask: {
        findUnique: jest.fn().mockResolvedValue(buildTask()),
        update: jest.fn().mockResolvedValue({ id: TASK_ID }),
      },
      storeSmsAccount: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ balanceFen: 9_900 }),
      },
      smsWalletLog: { create: jest.fn().mockResolvedValue({ id: 1 }) },
      $transaction: jest.fn((fn: (client: unknown) => unknown) => fn(tx)),
    };

    service = new SmsDeliveryCallbackService(
      prisma as unknown as PrismaService,
    );
  });

  it('送达成功：写回 delivered', async () => {
    const result = await service.handleCallback([
      { serialNo: 'sn-1', reportStatus: 'SUCCESS', errMsg: '' },
    ]);

    expect(result.matched).toBe(1);
    expect(result.delivered).toBe(1);

    expect(prisma.smsBroadcastRecipient.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ deliveryStatus: 'delivered' }),
      }),
    );
  });

  it('送达失败：如实记录送达结果，但按「提交计费」不退费', async () => {
    const result = await service.handleCallback([
      { serialNo: 'sn-1', reportStatus: 'UNDELIV', errMsg: '空号' },
    ]);

    expect(result.failed).toBe(1);
    // 送达结果仍然落库：商户要靠它清洗名单
    expect(prisma.smsBroadcastRecipient.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          deliveryStatus: 'failed',
          deliveryCode: 'UNDELIV',
          deliveryMessage: '空号',
        }),
      }),
    );
    // 但不产生任何退款流水
    expect(tx.smsWalletLog.create).not.toHaveBeenCalled();
    expect(tx.storeSmsAccount.updateMany).not.toHaveBeenCalled();
  });

  it('重复推送：同一结果不重复更新', async () => {
    recipient.deliveryStatus = 'failed';

    const result = await service.handleCallback([
      { serialNo: 'sn-1', reportStatus: 'UNDELIV' },
    ]);

    expect(result.duplicated).toBe(1);
    expect(result.failed).toBe(0);
    expect(prisma.smsBroadcastRecipient.update).not.toHaveBeenCalled();
  });

  it('未知状态码：不落库，避免误判', async () => {
    const result = await service.handleCallback([
      { serialNo: 'sn-1', reportStatus: 'SUBMITTED_TO_CARRIER' },
    ]);

    expect(result.matched).toBe(0);
    expect(result.unknown).toBe(1);
    expect(prisma.smsBroadcastRecipient.update).not.toHaveBeenCalled();
  });

  it('流水号缺失 / 查无此号：计为 unmatched，不影响其它回执', async () => {
    prisma.smsBroadcastRecipient.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(recipient);

    const result = await service.handleCallback([
      { reportStatus: 'UNDELIV' },
      { serialNo: 'unknown-sn', reportStatus: 'SUCCESS' },
    ]);

    expect(result.received).toBe(1); // 缺流水号的那条没进 reports
    expect(result.unmatched).toBe(1);
  });

  it('兼容多种报文字段名与外层包裹', async () => {
    prisma.smsBroadcastRecipient.findFirst.mockResolvedValue(recipient);

    const result = await service.handleCallback({
      data: [{ SerialNo: 'sn-9', status: 'SUCCESS', errmsg: 'ok' }],
    });

    expect(result.matched).toBe(1);
    expect(result.delivered).toBe(1);
    expect(prisma.smsBroadcastRecipient.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { serialNo: 'sn-9' } }),
    );
  });

  it('单条处理抛错不影响整批，其余回执照常处理', async () => {
    prisma.smsBroadcastTask.update.mockRejectedValueOnce(new Error('DB down'));

    const result = await service.handleCallback([
      { serialNo: 'sn-1', reportStatus: 'SUCCESS' },
    ]);

    expect(result.received).toBe(1);
    expect(result.matched).toBe(0);
    expect(result.unmatched).toBe(1);
  });
});
