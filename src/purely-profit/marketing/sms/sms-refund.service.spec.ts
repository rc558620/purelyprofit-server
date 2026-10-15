import { PrismaService } from '../../../prisma/prisma.service';
import { SmsRefundService } from './sms-refund.service';

/**
 * 退费引擎测试。
 *
 * 这里守的是三件事：金额算对、一条只退一次、绝不退超。
 * 任何一条失效都会直接造成资金损失。
 */
describe('SmsRefundService', () => {
  const TASK_ID = 777;
  const STORE_ID = 18;
  const RECIPIENT_ID = 5001;

  /** 20 人 × 每人 2 段 = 40 条，单价 5 分 → 扣费 200 分，每条 10 分 */
  const buildTask = (overrides: Record<string, unknown> = {}) => ({
    id: TASK_ID,
    storeId: STORE_ID,
    broadcastId: 'bc_refund',
    unitPriceFen: 5,
    smsSegments: 40,
    validMobileCount: 20,
    chargedAmountFen: 200,
    refundedAmountFen: 0,
    autoRefundedFen: 0,
    ...overrides,
  });

  let service: SmsRefundService;
  let tx: {
    smsBroadcastRecipient: {
      findUnique: jest.Mock;
      update: jest.Mock;
      findMany: jest.Mock;
    };
    smsBroadcastTask: { findUnique: jest.Mock; update: jest.Mock };
    storeSmsAccount: { updateMany: jest.Mock; findUniqueOrThrow: jest.Mock };
    smsWalletLog: { create: jest.Mock };
  };
  let prisma: {
    smsBroadcastRecipient: { findMany: jest.Mock };
    $transaction: jest.Mock;
  };

  beforeEach(() => {
    tx = {
      smsBroadcastRecipient: {
        findUnique: jest.fn().mockResolvedValue({
          id: RECIPIENT_ID,
          refundedAt: null,
          taskId: TASK_ID,
        }),
        update: jest.fn().mockResolvedValue({ id: RECIPIENT_ID }),
        findMany: jest.fn().mockResolvedValue([]),
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
      smsBroadcastRecipient: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn((fn: (client: unknown) => unknown) => fn(tx)),
    };

    service = new SmsRefundService(prisma as unknown as PrismaService);
  });

  it('按「每人分段数 × 单价」退这一条，不是退整单', async () => {
    const amount = await service.refundRecipient(RECIPIENT_ID);

    // 每人 2 段 × 5 分 = 10 分（整单是 200 分）
    expect(amount).toBe(10);
    expect(tx.storeSmsAccount.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          balanceFen: { increment: 10 },
          totalConsumedFen: { decrement: 10 },
        }),
      }),
    );
    expect(tx.smsWalletLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: 'refund', changeFen: 10 }),
      }),
    );
    // 退费闸门落库，保证不会再退第二次
    expect(tx.smsBroadcastRecipient.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ refundedAt: expect.any(Date) }),
      }),
    );
  });

  it('已退过费的明细：并发重入也只退一次', async () => {
    tx.smsBroadcastRecipient.findUnique.mockResolvedValue({
      id: RECIPIENT_ID,
      refundedAt: new Date(),
      taskId: TASK_ID,
    });

    await expect(service.refundRecipient(RECIPIENT_ID)).resolves.toBe(0);
    expect(tx.smsWalletLog.create).not.toHaveBeenCalled();
  });

  it('绝不退超：以「扣费额 - 已退额」为上限（含人工已退的部分）', async () => {
    tx.smsBroadcastTask.findUnique.mockResolvedValue(
      buildTask({ chargedAmountFen: 8 }),
    );

    await expect(service.refundRecipient(RECIPIENT_ID)).resolves.toBe(8);
  });

  it('人工已退过一部分时，自动退费只补差额', async () => {
    tx.smsBroadcastTask.findUnique.mockResolvedValue(
      buildTask({ chargedAmountFen: 200, refundedAmountFen: 195 }),
    );

    // 应退 10 分，但只剩 5 分可退
    await expect(service.refundRecipient(RECIPIENT_ID)).resolves.toBe(5);
  });

  it('无可退金额时不产生流水', async () => {
    tx.smsBroadcastTask.findUnique.mockResolvedValue(
      buildTask({ chargedAmountFen: 200, refundedAmountFen: 200 }),
    );

    await expect(service.refundRecipient(RECIPIENT_ID)).resolves.toBe(0);
    expect(tx.smsWalletLog.create).not.toHaveBeenCalled();
    expect(tx.smsBroadcastRecipient.update).not.toHaveBeenCalled();
  });

  it('任务不存在时安全返回 0', async () => {
    tx.smsBroadcastTask.findUnique.mockResolvedValue(null);

    await expect(service.refundRecipient(RECIPIENT_ID)).resolves.toBe(0);
  });

  it('只扫「提交失败」，送达失败不退（按提交计费）', async () => {
    await service.refundUndeliveredFailures(TASK_ID);

    const where = prisma.smsBroadcastRecipient.findMany.mock.calls[0][0].where;
    expect(where.refundedAt).toBeNull();
    expect(where.taskId).toBe(TASK_ID);
    // 只认提交失败；deliveryStatus=failed 的（送达失败）不在范围内
    expect(where.status).toBe('failed');
    expect(where.OR).toBeUndefined();
  });

  it('不传 taskId 时扫全库，用于兜住历史存量', async () => {
    prisma.smsBroadcastRecipient.findMany.mockResolvedValue([
      { id: 1, status: 'failed', deliveryStatus: null },
      { id: 2, status: 'failed', deliveryStatus: null },
    ]);

    const result = await service.refundUndeliveredFailures();

    // 两条各退 10 分
    expect(result.recipients).toBe(2);
    expect(result.amountFen).toBe(20);
    expect(
      prisma.smsBroadcastRecipient.findMany.mock.calls[0][0].where.taskId,
    ).toBeUndefined();
  });

  it('没有可退明细时不产生任何写操作', async () => {
    const result = await service.refundUndeliveredFailures(TASK_ID);

    expect(result).toEqual({ recipients: 0, amountFen: 0 });
    expect(tx.smsWalletLog.create).not.toHaveBeenCalled();
  });
});
