import { Module } from '@nestjs/common';
import { ClubPaymentsModule } from './club-payments.module';
import { ClubPaymentCallbackFailureModule } from './club-payment-callback-failure.module';
import { ClubPaymentCallbackProcessor } from '../../queue/club-payment-callback.processor';

/**
 * 微信支付回调消费者模块。
 *
 * 处理器依赖支付业务分发服务，因此放在业务模块旁边装配，
 * 避免 QueueModule 同时承担“队列注册 + 业务 provider 组装”的双重职责。
 *
 * 重试耗尽后由 ClubPaymentCallbackFailureService 落死信并告警，
 * 否则「钱已扣、余额未到账」只会留一行日志，无人知晓。
 */
@Module({
  imports: [ClubPaymentsModule, ClubPaymentCallbackFailureModule],
  providers: [ClubPaymentCallbackProcessor],
})
export class ClubPaymentCallbackProcessorModule {}
