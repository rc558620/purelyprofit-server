import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import {
  CLUB_PAYMENT_CALLBACK_DEFAULT_JOB_OPTIONS,
  CLUB_PAYMENT_CALLBACK_QUEUE_NAME,
} from './club-payment-callback-queue.constants';

/**
 * 微信支付回调队列注册模块。
 *
 * 只负责注册队列本身，不包含业务处理器，避免队列基础设施与业务消费逻辑相互纠缠。
 *
 * 重试 / 退避 / 保留策略**只在这里定义一次**（见
 * `club-payment-callback-queue.constants.ts`）：入队侧只传 jobId，
 * 禁止再写第二份 `attempts` / `backoff` —— per-job 参数会静默覆盖本文件默认值，
 * 两处漂移后「以为在重试、其实没重试」不会报错。仅当**单笔任务**确实需要
 * 不同策略时才在入队处显式覆盖，并在覆盖处写明理由。
 */
@Module({
  imports: [
    BullModule.registerQueue({
      name: CLUB_PAYMENT_CALLBACK_QUEUE_NAME,
      defaultJobOptions: CLUB_PAYMENT_CALLBACK_DEFAULT_JOB_OPTIONS,
    }),
  ],
  exports: [BullModule],
})
export class ClubPaymentCallbackQueueModule {}
