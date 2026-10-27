import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';

/**
 * 微信支付回调队列注册模块。
 *
 * 只负责注册 `club-payment-callback` 队列本身，
 * 不包含业务处理器，避免队列基础设施与业务消费逻辑相互纠缠。
 *
 * ⚠️ 这里的重试策略**覆盖**全局默认的 `attempts: 1`：
 * 支付回调没有「下一周期」可等（微信只重投有限次），落账失败若不重试
 * 就是「钱已扣、余额永久不到账」。采用指数退避而不是固定间隔，
 * 避免依赖方短暂抖动时把重试打在同一秒内。
 */
const CALLBACK_MAX_ATTEMPTS = 5;
const CALLBACK_BACKOFF_DELAY_MS = 2000;

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'club-payment-callback',
      defaultJobOptions: {
        attempts: CALLBACK_MAX_ATTEMPTS,
        backoff: {
          type: 'exponential',
          delay: CALLBACK_BACKOFF_DELAY_MS,
        },
      },
    }),
  ],
  exports: [BullModule],
})
export class ClubPaymentCallbackQueueModule {}
