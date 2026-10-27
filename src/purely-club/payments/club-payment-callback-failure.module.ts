import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ClubPaymentCallbackFailureService } from './club-payment-callback-failure.service';

/**
 * 支付回调死信模块。
 *
 * 单独成模块：死信记录同时被「回调消费者（写）」与「管理端补单入口（读 + 改）」
 * 两处依赖，挂在任何一侧都会让另一侧产生跨模块依赖。
 */
@Module({
  imports: [PrismaModule],
  providers: [ClubPaymentCallbackFailureService],
  exports: [ClubPaymentCallbackFailureService],
})
export class ClubPaymentCallbackFailureModule {}
