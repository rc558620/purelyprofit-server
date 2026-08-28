import { ClubPaymentCallbackDispatchService } from '../purely-club/payments/club-payment-callback-dispatch.service';
import { ClubPaymentCallbackProcessor } from './club-payment-callback.processor';

describe('ClubPaymentCallbackProcessor', () => {
  it('将支付回调任务分发到落账服务', async () => {
    const dispatchService = {
      dispatchByOrderNo: jest.fn().mockResolvedValue({
        orderNo: 'RC202606101231000001A2B',
        orderType: 'recharge',
        status: 'paid',
      }),
    };
    const processor = new ClubPaymentCallbackProcessor(
      dispatchService as unknown as ClubPaymentCallbackDispatchService,
    );

    const result = await processor.process({
      id: 'job-1',
      data: {
        orderNo: 'RC202606101231000001A2B',
        settlementParams: {
          amountFen: 50000,
          transactionId: 'wxTx123',
          paidAtMs: 1773558663000,
          callbackReceivedAtMs: 1773558664000,
        },
      },
    } as never);

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
    const dispatchService = {
      dispatchByOrderNo: jest.fn().mockRejectedValue(error),
    };
    const processor = new ClubPaymentCallbackProcessor(
      dispatchService as unknown as ClubPaymentCallbackDispatchService,
    );

    await expect(
      processor.process({
        id: 'job-2',
        data: {
          orderNo: 'SO202606101231000001A2B',
          settlementParams: {
            amountFen: 100,
            transactionId: 'wxTx456',
            paidAtMs: 1773558663000,
            callbackReceivedAtMs: 1773558664000,
          },
        },
      } as never),
    ).rejects.toBe(error);
  });
});
