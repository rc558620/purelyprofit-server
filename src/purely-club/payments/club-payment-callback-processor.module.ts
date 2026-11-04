import { Module } from '@nestjs/common';
import { ClubPaymentsModule } from './club-payments.module';
import { ClubPaymentCallbackQueueModule } from './club-payment-callback-queue.module';
import { ClubPaymentCallbackFailureModule } from './club-payment-callback-failure.module';
import { ClubPaymentCallbackProcessor } from '../../queue/club-payment-callback.processor';

/**
 * 微信支付回调消费者模块。
 *
 * 处理器依赖支付业务分发服务，因此放在业务模块旁边装配，
 * 避免 QueueModule 同时承担“队列注册 + 业务 provider 组装”的双重职责。
 *
 * ⚠️ 本模块**必须被一个应用级模块 import**（当前挂在 `QueueModule.imports`）。
 * BullExplorer 只扫描「已注册的 provider」来创建 worker：模块只声明不注册时，
 * processor 不会进入容器，回调照常入队却无人消费 —— 表现为「钱已扣、订单永不落账」，
 * 而且因为 HTTP 回调已返回 200，微信不会重投，属于最难发现的资金事故。
 *
 * 显式 import `ClubPaymentCallbackQueueModule` 是刻意保留的显式依赖：
 * BullExplorer 取队列 token 用的是全局查找（strict: false），靠 `ClubPaymentsModule`
 * 间接注册也能跑通，但那样「队列未注册」会退化成运行期静默无 worker，
 * 不如在这里把依赖摆明。
 *
 * 重试耗尽后由 ClubPaymentCallbackFailureService 落死信并告警，
 * 否则「钱已扣、余额未到账」只会留一行日志，无人知晓。
 */
@Module({
  imports: [
    ClubPaymentCallbackQueueModule,
    ClubPaymentsModule,
    ClubPaymentCallbackFailureModule,
  ],
  providers: [ClubPaymentCallbackProcessor],
})
export class ClubPaymentCallbackProcessorModule {}
