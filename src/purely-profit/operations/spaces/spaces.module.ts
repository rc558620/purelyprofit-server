import { Module } from '@nestjs/common';
import { CommerceModule } from '../../commerce/commerce.module';
import { MarketingModule } from '../../marketing/marketing.module';
import { PlatformMembershipModule } from '../../member/platform-membership/platform-membership.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { RedisModule } from '../../../redis/redis.module';
import { ClubScanOrderingModule } from '../../../purely-club/scan-ordering/club-scan-ordering.module';
import { ScanOrderingModule } from '../scan-ordering/scan-ordering.module';
import { SalesRecordModule } from '../sales-record/sales-record.module';
import { SpaceAutoCheckoutSchedulerService } from './space-auto-checkout-scheduler.service';
import { SpaceQrCodeService } from './space-qr-code.service';
import { SpaceSessionAutoCheckoutService } from './space-session-auto-checkout.service';
import { SpaceDashboardService } from './space-dashboard.service';
import { SpaceReservationsController } from './space-reservations.controller';
import { SpacesRefResolverService } from './spaces-ref-resolver.service';
import { SpaceReservationsStateService } from './space-reservations-state.service';
import { SpaceReservationsService } from './space-reservations.service';
import { SpaceReservationsWriteService } from './space-reservations-write.service';
import { SpaceSessionCheckoutLockService } from './space-session-checkout-lock.service';
import { SpaceSessionCheckoutService } from './space-session-checkout.service';
import { SpaceSessionOpenService } from './space-session-open.service';
import { SpaceSessionPreviewService } from './space-session-preview.service';
import { SpaceSessionReadService } from './space-session-read.service';
import { SpaceSessionReadStateService } from './space-session-read-state.service';
import { SpaceSessionRenewService } from './space-session-renew.service';
import { SpaceSessionVoucherReadService } from './space-session-voucher-read.service';
import { SpaceDashboardSummaryService } from './space-dashboard-summary.service';
import { SpaceSessionSettlementService } from './space-session-settlement.service';
import { SpaceSessionSaleOrderService } from './space-session-sale-order.service';
import { SpaceSessionTransferService } from './space-session-transfer.service';
import { SpaceSessionWriteService } from './space-session-write.service';
import { StoresModule } from '../../stores/stores.module';
import { SpaceSessionsController } from './space-sessions.controller';
import { SpaceSessionsService } from './space-sessions.service';
import { SpaceTypesController } from './space-types.controller';
import { SpaceTypesService } from './space-types.service';
import { SpaceZonesController } from './space-zones.controller';
import { SpaceZonesService } from './space-zones.service';
import { SpacesController } from './spaces.controller';
import { SpacePrintController } from './space-print.controller';
import { SpacePrintService } from './space-print.service';
import { SpacePrintDataService } from './space-print-data.service';
import { SpacePrintSettingsService } from './space-print-settings.service';
import { SpacesReadService } from './spaces-read.service';
import { SpacesService } from './spaces.service';
import { SpacesStatusService } from './spaces-status.service';
import { SpacesWriteService } from './spaces-write.service';

@Module({
  imports: [
    PrismaModule,
    CommerceModule,
    MarketingModule,
    PlatformMembershipModule,
    SalesRecordModule,
    RedisModule,
    ClubScanOrderingModule,
    StoresModule,
    // 复用扫码点餐的打印通道基础设施（云/USB/代理/ESC-POS）
    ScanOrderingModule,
  ],
  controllers: [
    SpaceTypesController,
    SpaceZonesController,
    SpacesController,
    SpaceReservationsController,
    SpaceSessionsController,
    SpacePrintController,
  ],
  providers: [
    SpacesService,
    SpacesReadService,
    SpacesWriteService,
    SpacesStatusService,
    SpacesRefResolverService,
    SpaceTypesService,
    SpaceZonesService,
    SpaceReservationsStateService,
    SpaceReservationsService,
    SpaceReservationsWriteService,
    SpaceSessionCheckoutLockService,
    SpaceSessionCheckoutService,
    SpaceSessionAutoCheckoutService,
    SpaceSessionOpenService,
    SpaceSessionPreviewService,
    SpaceSessionReadService,
    SpaceSessionReadStateService,
    SpaceSessionRenewService,
    SpaceSessionVoucherReadService,
    SpaceDashboardSummaryService,
    SpaceSessionSaleOrderService,
    SpaceSessionSettlementService,
    SpaceSessionTransferService,
    SpaceSessionWriteService,
    SpaceSessionsService,
    SpaceDashboardService,
    SpaceAutoCheckoutSchedulerService,
    SpaceQrCodeService,
    SpacePrintSettingsService,
    SpacePrintDataService,
    SpacePrintService,
  ],
  exports: [SpaceSessionSettlementService, SpaceSessionAutoCheckoutService],
})
export class SpacesModule {}
