import { Module } from '@nestjs/common';
import { ClubPaymentsModule } from './club-payments.module';
import { ClubPaymentCallbackProcessor } from '../../queue/club-payment-callback.processor';

/**
 * 微信支付回调消费者模块。
 *
 * 处理器依赖支付业务分发服务，因此放在业务模块旁边装配，
 * 避免 QueueModule 同时承担“队列注册 + 业务 provider 组装”的双重职责。
 */
@Module({
  imports: [ClubPaymentsModule],
  providers: [ClubPaymentCallbackProcessor],
})
export class ClubPaymentCallbackProcessorModule {}
