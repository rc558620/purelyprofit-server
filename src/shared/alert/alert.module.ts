import { Global, Module } from '@nestjs/common';
import { AlertService } from './alert.service';

/**
 * 告警模块。
 *
 * 设为 @Global：资金链路（支付回调、落账、关单）分布在不同模块里，
 * 逐级 import 会让「新增一个告警点」变成一次依赖改造，反而抑制告警的补充。
 */
@Global()
@Module({
  providers: [AlertService],
  exports: [AlertService],
})
export class AlertModule {}
