// 纯利宝会员卡模块（C 端）：可购卡 / 购卡下单 / 查单 / 卡包 / 卡详情
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ClubPaymentModeModule } from '../payments/club-payment-mode.module';
import { ClubWechatPayModule } from '../payments/club-wechat-pay.module';
import { ClubOrderIdempotencyService } from '../shared/club-order-idempotency.service';
import { ClubStoresModule } from '../stores/club-stores.module';
import { ClubCardContextService } from './club-card-context.service';
import { ClubCardImmediateSettlementService } from './club-card-immediate-settlement.service';
import { ClubCardOrderService } from './club-card-order.service';
import { ClubCardQueryService } from './club-card-query.service';
import { ClubCardSettlementService } from './club-card-settlement.service';
import { ClubCardsController } from './club-cards.controller';

/**
 * 只依赖「不会反向依赖订单模块」的支付子模块：
 * - ClubWechatPayModule：JSAPI 下单 / 回源核对；
 * - ClubPaymentModeModule：手动确认支付的资金闸门 + openid 解析。
 *
 * 刻意**不**导入 ClubPaymentsModule：回调分发器需要注入本模块的
 * ClubCardOrderService，反向导入会形成循环依赖。
 */
@Module({
  imports: [
    PrismaModule,
    ClubStoresModule,
    ClubWechatPayModule,
    ClubPaymentModeModule,
  ],
  controllers: [ClubCardsController],
  providers: [
    ClubCardContextService,
    ClubCardQueryService,
    ClubCardOrderService,
    // 落账事务（建卡 + purchase 流水）独立成服务，回调与手动确认共用
    ClubCardSettlementService,
    // 零元卡 / 余额支付的即时落账：下单即发卡，不走微信收银台
    ClubCardImmediateSettlementService,
    // 幂等键缓存与团购券 / 服务订单共用同一实现（仅依赖全局 RedisModule）
    ClubOrderIdempotencyService,
  ],
  exports: [
    // 支付回调分发器（ClubPaymentsModule）需要调用购卡落账
    ClubCardOrderService,
  ],
})
export class ClubCardsModule {}
