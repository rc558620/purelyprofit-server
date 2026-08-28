import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';

/**
 * 微信支付回调队列注册模块。
 *
 * 只负责注册 `club-payment-callback` 队列本身，
 * 不包含业务处理器，避免队列基础设施与业务消费逻辑相互纠缠。
 */
@Module({
  imports: [BullModule.registerQueue({ name: 'club-payment-callback' })],
  exports: [BullModule],
})
export class ClubPaymentCallbackQueueModule {}
