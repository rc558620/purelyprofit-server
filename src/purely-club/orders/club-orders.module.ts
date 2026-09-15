import { Module } from '@nestjs/common';
import { AuthModule } from '../../purely-profit/auth/auth.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { ClubMemberModule } from '../member/club-member.module';
import { ClubStoresModule } from '../stores/club-stores.module';
import { ClubWechatPayModule } from '../payments/club-wechat-pay.module';
import { ClubOrderDraftsService } from './club-order-drafts.service';
import { ClubOrderPromotionsService } from './club-order-promotions.service';
import { ClubOrderServiceContextService } from './club-order-service-context.service';
import { ClubOrderServiceCreationService } from './club-order-service-creation.service';
import { ClubOrderServicePaymentService } from './club-order-service-payment.service';
import { ClubOrderServiceQueryService } from './club-order-service-query.service';
import { ClubOrderSettlementService } from './club-order-settlement.service';
import { ClubPaymentLockService } from '../payments/club-payment-lock.service';
import { ClubOrdersController } from './club-orders.controller';
import { ClubOrderPreviewService } from './club-order-preview.service';
import { ClubMarketingPreviewService } from './club-marketing-preview.service';
import { ClubOrderPreviewBreakdownService } from './club-order-preview-breakdown.service';
import { ClubOrdersService } from './club-orders.service';
import { ClubPromotionRepository } from '../shared/club-promotion.repository';
import { PlatformMembershipAccessModule } from '../../purely-profit/member/platform-membership/platform-membership-access.module';

@Module({
  imports: [
    AuthModule,
    PrismaModule,
    ClubStoresModule,
    ClubMemberModule,
    ClubWechatPayModule,
    // 会员过期门店需拦截会员专区服务购买，依赖该模块提供的 MembershipDowngradeService
    PlatformMembershipAccessModule,
  ],
  controllers: [ClubOrdersController],
  providers: [
    ClubOrderDraftsService,
    ClubOrderPromotionsService,
    ClubOrderServiceContextService,
    ClubOrderServiceCreationService,
    ClubOrderServiceQueryService,
    ClubOrderServicePaymentService,
    ClubOrderSettlementService,
    ClubPaymentLockService,
    ClubOrderPreviewService,
    ClubMarketingPreviewService,
    ClubOrderPreviewBreakdownService,
    ClubOrdersService,
    ClubPromotionRepository,
  ],
  exports: [
    ClubOrderPreviewService,
    ClubMarketingPreviewService,
    ClubOrderDraftsService,
    ClubOrderServicePaymentService,
    ClubOrdersService,
  ],
})
export class ClubOrdersModule {}
