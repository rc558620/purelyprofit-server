import {
  buildClubPaymentCallbackJobKey,
  CLUB_PAYMENT_CALLBACK_DEFAULT_JOB_OPTIONS,
  CLUB_PAYMENT_CALLBACK_QUEUE_NAME,
} from './club-payment-callback-queue.constants';

describe('club-payment-callback-queue.constants', () => {
  it('jobId 只由订单号决定，与 transactionId 无关', () => {
    const orderNo = 'RC202606101231000001A2B';

    expect(buildClubPaymentCallbackJobKey(orderNo)).toBe(
      `wechat-payment-${orderNo}`,
    );
    // 同一订单号多次构造必须完全一致，否则 BullMQ 去重失效
    expect(buildClubPaymentCallbackJobKey(orderNo)).toBe(
      buildClubPaymentCallbackJobKey(orderNo),
    );
  });

  it('jobId 不含冒号（BullMQ 5.x 会直接拒绝，旧实现只靠 3 段冒号豁免在跑）', () => {
    expect(
      buildClubPaymentCallbackJobKey('RC202606101231000001A2B'),
    ).not.toContain(':');
  });

  it('默认任务选项保留重试与退避（回调无「下一周期」可等，失败即永久不到账）', () => {
    expect(CLUB_PAYMENT_CALLBACK_QUEUE_NAME).toBe('club-payment-callback');
    expect(CLUB_PAYMENT_CALLBACK_DEFAULT_JOB_OPTIONS.attempts).toBe(5);
    expect(CLUB_PAYMENT_CALLBACK_DEFAULT_JOB_OPTIONS.backoff).toEqual({
      type: 'exponential',
      delay: 2_000,
    });
  });

  it('默认任务选项自带保留策略（registerQueue 会整体覆盖 forRoot 的全局默认值）', () => {
    expect(CLUB_PAYMENT_CALLBACK_DEFAULT_JOB_OPTIONS.removeOnComplete).toEqual({
      age: 86_400,
      count: 10_000,
    });
    expect(CLUB_PAYMENT_CALLBACK_DEFAULT_JOB_OPTIONS.removeOnFail).toEqual({
      age: 604_800,
      count: 10_000,
    });
  });
});
