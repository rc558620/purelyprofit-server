import { ClubPaymentCallbackDispatchService } from '../purely-club/payments/club-payment-callback-dispatch.service';
import { ClubPaymentCallbackFailureService } from '../purely-club/payments/club-payment-callback-failure.service';
import { ClubPaymentCallbackProcessor } from './club-payment-callback.processor';

/** 落账入参桩：四个字段与微信回调携带的结算参数一致 */
const SETTLEMENT_PARAMS = {
  amountFen: 50000,
  transactionId: 'wxTx123',
  paidAtMs: 1773558663000,
  callbackReceivedAtMs: 1773558664000,
};

const buildJob = (id: string, orderNo: string) => ({
  id,
  data: {
    orderNo,
    settlementParams: SETTLEMENT_PARAMS,
  },
});

describe('ClubPaymentCallbackProcessor', () => {
  const createDispatchService = (
    impl: jest.Mock,
  ): ClubPaymentCallbackDispatchService =>
    ({
      dispatchByOrderNo: impl,
    }) as unknown as ClubPaymentCallbackDispatchService;

  const createFailureService = (): ClubPaymentCallbackFailureService =>
    ({
      recordRetryExhausted: jest.fn().mockResolvedValue(undefined),
    }) as unknown as ClubPaymentCallbackFailureService;

  it('将支付回调任务分发到落账服务', async () => {
    const dispatchService = createDispatchService(
      jest.fn().mockResolvedValue({
        orderNo: 'RC202606101231000001A2B',
        orderType: 'recharge',
        status: 'paid',
      }),
    );
    const failureService = createFailureService();
    const processor = new ClubPaymentCallbackProcessor(
      dispatchService,
      failureService,
    );

    const result = await processor.process(
      buildJob('job-1', 'RC202606101231000001A2B') as never,
    );

    expect(result).toEqual({
      orderNo: 'RC202606101231000001A2B',
      orderType: 'recharge',
      status: 'paid',
    });
    expect(dispatchService.dispatchByOrderNo).toHaveBeenCalledWith(
      'RC202606101231000001A2B',
      expect.objectContaining({ transactionId: 'wxTx123' }),
    );
  });

  it('分发失败时向 BullMQ 抛出异常以触发重试', async () => {
    const error = new Error('数据库暂时不可用');
    const dispatchService = createDispatchService(
      jest.fn().mockRejectedValue(error),
    );
    const processor = new ClubPaymentCallbackProcessor(
      dispatchService,
      createFailureService(),
    );

    await expect(
      processor.process(buildJob('job-2', 'SO202606101231000001A2B') as never),
    ).rejects.toBe(error);
  });

  // D8：只有重试耗尽才落死信。中间失败是正常抖动，落死信会淹没真正的人工待办。
  it('重试未耗尽时不落死信，交给 BullMQ 继续重试', async () => {
    const failureService = createFailureService();
    const processor = new ClubPaymentCallbackProcessor(
      createDispatchService(jest.fn()),
      failureService,
    );

    await processor.onFailed(
      {
        ...buildJob('job-3', 'RC202606101231000001A2B'),
        attemptsMade: 2,
        opts: { attempts: 5 },
      } as never,
      new Error('数据库暂时不可用'),
    );

    expect(failureService.recordRetryExhausted).not.toHaveBeenCalled();
  });

  it('重试耗尽时落死信并告警，避免「钱已扣无人知晓」', async () => {
    const failureService = createFailureService();
    const processor = new ClubPaymentCallbackProcessor(
      createDispatchService(jest.fn()),
      failureService,
    );

    await processor.onFailed(
      {
        ...buildJob('job-4', 'RC202606101231000001A2B'),
        attemptsMade: 5,
        opts: { attempts: 5 },
      } as never,
      new Error('订单不存在'),
    );

    expect(failureService.recordRetryExhausted).toHaveBeenCalledWith(
      expect.objectContaining({
        orderNo: 'RC202606101231000001A2B',
        attempts: 5,
        reason: '订单不存在',
      }),
    );
  });

  it('死信写入失败时不影响 worker，仅记录日志', async () => {
    const failureService = {
      recordRetryExhausted: jest
        .fn()
        .mockRejectedValue(new Error('数据库不可用')),
    } as unknown as ClubPaymentCallbackFailureService;
    const processor = new ClubPaymentCallbackProcessor(
      createDispatchService(jest.fn()),
      failureService,
    );

    await expect(
      processor.onFailed(
        {
          ...buildJob('job-5', 'RC202606101231000001A2B'),
          attemptsMade: 5,
          opts: { attempts: 5 },
        } as never,
        new Error('订单不存在'),
      ),
    ).resolves.toBeUndefined();
  });
});
