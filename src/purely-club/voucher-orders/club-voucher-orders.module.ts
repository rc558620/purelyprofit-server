// 纯利宝团购券订单模块：依赖订单促销/微信支付/门店上下文，提供 Club 端团购券订单能力
import { Module } from '@nestjs/common';
import { AuthModule } from '../../purely-profit/auth/auth.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { StoresModule } from '../../purely-profit/stores/stores.module';
import { ClubStoresModule } from '../stores/club-stores.module';
import { ClubWechatPayModule } from '../payments/club-wechat-pay.module';
import { ClubScanOrderingModule } from '../scan-ordering/club-scan-ordering.module';
import { ClubOrderPromotionsService } from '../orders/club-order-promotions.service';
import { ClubOrderPreviewBreakdownService } from '../orders/club-order-preview-breakdown.service';
import { ClubMemberModule } from '../member/club-member.module';
import { ClubPromotionRepository } from '../shared/club-promotion.repository';
import { ClubWechatRefundService } from '../payments/club-wechat-refund.service';
import { ClubVoucherOrderContextService } from './club-voucher-order-context.service';
import { ClubVoucherOrderPaymentService } from './club-voucher-order-payment.service';
import { ClubVoucherOrderQueryService } from './club-voucher-order-query.service';
import { ClubVoucherOrderRefundService } from './club-voucher-order-refund.service';
import { ClubVoucherOrderVerifyService } from './club-voucher-order-verify.service';
import { ClubVoucherOrdersController } from './club-voucher-orders.controller';
import { ClubVoucherOrdersService } from './club-voucher-orders.service';

@Module({
  imports: [
    AuthModule,
    PrismaModule,
    StoresModule,
    ClubStoresModule,
    ClubMemberModule,
    ClubWechatPayModule,
    // 团购券支付成功需广播 voucher_order.created（ScanOrderingRealtimeService）
    ClubScanOrderingModule,
  ],
  controllers: [ClubVoucherOrdersController],
  providers: [
    ClubVoucherOrderContextService,
    ClubVoucherOrderPaymentService,
    ClubVoucherOrderQueryService,
    ClubVoucherOrderRefundService,
    ClubVoucherOrderVerifyService,
    ClubVoucherOrdersService,
    ClubWechatRefundService,
    // 订单促销服务与会员等级依赖（与 club-orders 模块共享同一实例来源）
    ClubOrderPromotionsService,
    ClubPromotionRepository,
    // 优惠拆解展示行生成（与服务商品 preview 同口径）
    ClubOrderPreviewBreakdownService,
  ],
  exports: [
    ClubVoucherOrdersService,
    ClubVoucherOrderQueryService,
    // 商家端拒绝接单复用退款链路（含微信原路退回 + 积分返还 + 库存回补）
    ClubVoucherOrderRefundService,
  ],
})
export class ClubVoucherOrdersModule {}
