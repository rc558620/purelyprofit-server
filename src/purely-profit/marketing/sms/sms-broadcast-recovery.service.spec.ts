import { PrismaService } from '../../../prisma/prisma.service';
import { SmsBroadcastRecoveryService } from './sms-broadcast-recovery.service';
import { SmsBroadcastService } from './sms-broadcast.service';

describe('SmsBroadcastRecoveryService', () => {
  let service: SmsBroadcastRecoveryService;
  let prisma: {
    smsBroadcastTask: { findMany: jest.Mock };
    smsBroadcastRecipient: { findMany: jest.Mock };
  };
  let broadcastService: { resumeDispatch: jest.Mock };

  beforeEach(() => {
    prisma = {
      smsBroadcastTask: { findMany: jest.fn().mockResolvedValue([]) },
      smsBroadcastRecipient: { findMany: jest.fn().mockResolvedValue([]) },
    };
    broadcastService = {
      resumeDispatch: jest.fn().mockResolvedValue(undefined),
    };
    service = new SmsBroadcastRecoveryService(
      prisma as unknown as PrismaService,
      broadcastService as unknown as SmsBroadcastService,
    );
  });

  it('没有卡死任务时不调用补发', async () => {
    const recovered = await service.recoverStuckTasks();

    expect(recovered).toBe(0);
    expect(broadcastService.resumeDispatch).not.toHaveBeenCalled();
  });

  it('卡在 sending 的任务会被逐个补发', async () => {
    prisma.smsBroadcastTask.findMany.mockResolvedValue([
      { id: 11, broadcastId: 'bc_1', storeId: 18 },
      { id: 12, broadcastId: 'bc_2', storeId: 19 },
    ]);

    const recovered = await service.recoverStuckTasks();

    expect(recovered).toBe(2);
    expect(broadcastService.resumeDispatch).toHaveBeenCalledTimes(2);
    expect(broadcastService.resumeDispatch).toHaveBeenNthCalledWith(1, 11);
    expect(broadcastService.resumeDispatch).toHaveBeenNthCalledWith(2, 12);
  });

  it('扫描条件包含「卡在 sending」与「仍有 pending 明细」两类任务', async () => {
    await service.recoverStuckTasks();

    const where = prisma.smsBroadcastTask.findMany.mock.calls[0][0].where;
    // 超时阈值：updatedAt 必须早于「现在 - 卡死阈值」
    expect(where.updatedAt.lt).toBeInstanceOf(Date);
    expect(where.updatedAt.lt.getTime()).toBeLessThan(Date.now());
    // 两类都捞：卡死的任务，以及有未决明细（通道没给结果）的任务
    const clauses = where.OR as Record<string, unknown>[];
    expect(clauses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: 'sending' }),
        expect.objectContaining({ id: { in: [] } }),
      ]),
    );
  });

  it('单个任务补发失败不影响整轮扫描', async () => {
    prisma.smsBroadcastTask.findMany.mockResolvedValue([
      { id: 11, broadcastId: 'bc_1', storeId: 18 },
      { id: 12, broadcastId: 'bc_2', storeId: 19 },
    ]);
    broadcastService.resumeDispatch
      .mockRejectedValueOnce(new Error('通道不可用'))
      .mockResolvedValueOnce(undefined);

    const recovered = await service.recoverStuckTasks();

    // 失败的那个不计入 recovered，但第二个仍然被处理
    expect(recovered).toBe(1);
    expect(broadcastService.resumeDispatch).toHaveBeenCalledTimes(2);
  });
});
