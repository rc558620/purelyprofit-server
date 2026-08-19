import { Module } from '@nestjs/common';
import { CommerceModule } from '../../commerce/commerce.module';
import { SalesRecordModule } from '../sales-record/sales-record.module';
import { StoresModule } from '../../stores/stores.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { RedisModule } from '../../../redis/redis.module';
import { ClubScanOrderingModule } from '../../../purely-club/scan-ordering/club-scan-ordering.module';
import { ClubServiceCallModule } from '../../../purely-club/service-call/club-service-call.module';
import { ManualEntryModule } from './manual-entry/manual-entry.module';
import { ScanOrderingMainController } from './scan-ordering.controller';
import { ScanOrderingOrderController } from './scan-ordering-orders.controller';
import { ScanOrderingTableController } from './scan-ordering-table.controller';
import { ScanOrderingPrintController } from './scan-ordering-print.controller';
import { ScanOrderingServiceCallController } from './scan-ordering-service-call.controller';
import { ScanOrderingAreaService } from './scan-ordering-area.service';
import { ScanOrderingTypeService } from './scan-ordering-type.service';
import { ScanOrderingDashboardService } from './scan-ordering-dashboard.service';
import { ScanOrderingPricingService } from './scan-ordering-pricing.service';
import { ScanOrderingQrService } from './scan-ordering-qr.service';
import { ScanOrderingTableService } from './scan-ordering-table.service';
import { ScanOrderingTableQueryService } from './scan-ordering-table-query.service';
import { ScanOrderingOrderService } from './scan-ordering-order.service';
import { ScanOrderingOrderRefundHandlingService } from './scan-ordering-order-refund.service';
import { ScanOrderingOrderRefundBalanceService } from './scan-ordering-order-refund-balance.service';
import { ScanOrderingRefundStockRestoreService } from './scan-ordering-refund-stock-restore.service';
import { ScanOrderingOrderStateMachineService } from './scan-ordering-order-machine.service';
import { ScanOrderingOrderTransitionEngineService } from './scan-ordering-order-transition.service';
import { ScanOrderingServiceCallService } from './scan-ordering-service-call.service';
import { ScanOrderingMenuService } from './scan-ordering-menu.service';
import { ScanOrderingMenuCategoryService } from './scan-ordering-menu-category.service';
import { ScanOrderingMenuProductService } from './scan-ordering-menu-product.service';
import { ScanOrderingMenuSpecService } from './scan-ordering-menu-spec.service';
import { ScanOrderingMenuStockService } from './scan-ordering-menu-stock.service';
import { ScanOrderingMenuQueryService } from './scan-ordering-menu-query.service';
import { ScanOrderingSessionArchiveService } from './scan-ordering-session-archive.service';
import { ConfigService } from '@nestjs/config';
import { ScanOrderingPrintSettingsService } from './scan-ordering-print-settings.service';
import { ScanOrderingPrintDataService } from './scan-ordering-print-data.service';
import { FeiePrintService } from './feie-print.service';
import { ScanOrderingCloudPrintService } from './scan-ordering-cloud-print.service';
import { EscPosTicketBuilder } from './escpos-ticket.builder';
import type { EscPosEncoding } from './escpos-ticket.builder';
import { UsbPrintService } from './usb-print.service';
import { ScanOrderingUsbPrintService } from './scan-ordering-usb-print.service';
import { PrintAgentService } from './print-agent.service';

/** 扫码点餐领域模块：商家管理、消费者点餐、订单与支付共享同一领域规则。 */
@Module({
  imports: [
    PrismaModule,
    CommerceModule,
    SalesRecordModule,
    RedisModule,
    StoresModule,
    ClubScanOrderingModule,
    ClubServiceCallModule,
    ManualEntryModule,
  ],
  controllers: [
    ScanOrderingMainController,
    ScanOrderingOrderController,
    ScanOrderingTableController,
    ScanOrderingPrintController,
    ScanOrderingServiceCallController,
  ],
  providers: [
    ScanOrderingAreaService,
    ScanOrderingTypeService,
    ScanOrderingDashboardService,
    ScanOrderingPricingService,
    ScanOrderingQrService,
    ScanOrderingTableService,
    ScanOrderingTableQueryService,
    ScanOrderingOrderService,
    ScanOrderingOrderRefundHandlingService,
    ScanOrderingOrderRefundBalanceService,
    ScanOrderingRefundStockRestoreService,
    ScanOrderingOrderTransitionEngineService,
    ScanOrderingOrderStateMachineService,
    ScanOrderingServiceCallService,
    // Menu services
    ScanOrderingMenuCategoryService,
    ScanOrderingMenuProductService,
    ScanOrderingMenuSpecService,
    ScanOrderingMenuStockService,
    ScanOrderingMenuQueryService,
    ScanOrderingMenuService,
    ScanOrderingSessionArchiveService,
    ScanOrderingPrintSettingsService,
    ScanOrderingPrintDataService,
    FeiePrintService,
    ScanOrderingCloudPrintService,
    UsbPrintService,
    ScanOrderingUsbPrintService,
    PrintAgentService,
    {
      provide: EscPosTicketBuilder,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) =>
        new EscPosTicketBuilder(
          (configService.get<string>('usbPrint.encoding') ??
            'gbk') as EscPosEncoding,
        ),
    },
  ],
  exports: [
    ScanOrderingPricingService,
    ScanOrderingSessionArchiveService,
    // 打印通道基础设施（云/USB/代理/ESC-POS）：供空间管理（general 业态）打印域复用
    FeiePrintService,
    UsbPrintService,
    PrintAgentService,
    EscPosTicketBuilder,
  ],
})
export class ScanOrderingModule {}
