import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ClubPaymentModeController } from './club-payment-mode.controller';
import { ClubPaymentModeService } from './club-payment-mode.service';
import { ClubWechatOpenidService } from './club-wechat-openid.service';

/**
 * 支付模式模块。
 *
 * 只依赖全局模块（ConfigModule / RedisModule）与 PrismaModule，
 * 不反向依赖 ClubPaymentsModule 或任何订单模块：
 * 订单、充值、团购券等模块都需要注入本模块的
 * ClubPaymentModeService 来做「能否跳过真实扣款」的裁决，
 * 独立成模块才能避免循环依赖。
 *
 * ClubWechatOpenidService 也放在这里：它只依赖 Prisma，
 * 而五条下单链路所在模块均已引入本模块，可统一复用。
 */
@Module({
  imports: [PrismaModule],
  controllers: [ClubPaymentModeController],
  providers: [ClubPaymentModeService, ClubWechatOpenidService],
  exports: [ClubPaymentModeService, ClubWechatOpenidService],
})
export class ClubPaymentModeModule {}
